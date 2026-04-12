"""Workflow Orchestrator — multi-agent chain execution engine.

Replaces the Phase 2 linear runner with a configurable agent chain built on
the Strands Agents SDK.  Each pipeline stage is a Strands ``Agent`` instance
whose factory function lives in ``services.workflow.agents.*``.

The orchestrator:
1. Resolves the agent chain from workspace config (or uses the default).
2. Loads versioned prompts via :class:`PromptRegistry`.
3. Instantiates each agent via its factory.
4. Executes agents sequentially, passing output forward.
5. Records per-step telemetry (:class:`AgentStep`).
6. Handles dual-pipeline extraction when reconciliation is in the chain.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, Callable

from services.workflow.agents.parsing import create_parsing_agent
from services.workflow.agents.extraction import create_extraction_agent
from services.workflow.agents.validation import create_validation_agent
from services.workflow.agents.reconciliation import create_reconciliation_agent
from services.workflow.models import (
    AgentConfig,
    AgentStep,
    ProcessingEvent,
    WorkflowResult,
)
from services.workflow.prompts import PromptRegistry
from services.workflow.state_machine import WorkflowState, WorkflowStateMachine

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

DEFAULT_CHAIN: list[str] = [
    "parsing",
    "extraction",
    "reconciliation",
    "validation",
]

def _get_agent_factories() -> dict[str, Callable]:
    """Return the agent name → factory mapping.

    Defined as a function so that tests can patch individual factory
    functions and have the patches take effect.
    """
    return {
        "parsing": create_parsing_agent,
        "extraction": create_extraction_agent,
        "validation": create_validation_agent,
        "reconciliation": create_reconciliation_agent,
    }

AGENT_TO_STATE: dict[str, WorkflowState] = {
    "parsing": WorkflowState.parsing,
    "extraction": WorkflowState.reasoning,
    "reconciliation": WorkflowState.reconciling,
    "validation": WorkflowState.validating,
}


class WorkflowOrchestrator:
    """Execute a configurable agent chain for a single document trace.

    Parameters
    ----------
    event:
        The processing event containing trace_id, workspace_id, etc.
    workspace:
        The workspace configuration dict (loaded from DynamoDB).
    """

    # ── 5.1  __init__ and chain resolution ─────────────────────────────────

    def __init__(self, event: ProcessingEvent, workspace: dict[str, Any]) -> None:
        self.event = event
        self.workspace = workspace
        self.agent_steps: list[AgentStep] = []
        self._prompt_registry = PromptRegistry()
        self._prompt_versions: dict[str, str] = {}

        # Resolve agent chain from workspace config
        self._chain = self._resolve_chain(workspace)

    # ── Chain resolution ───────────────────────────────────────────────────

    @staticmethod
    def _resolve_chain(workspace: dict[str, Any]) -> list[AgentConfig]:
        """Parse ``workspace["agents"]`` into a list of :class:`AgentConfig`.

        Accepts:
        - A list of plain strings: ``["parsing", "extraction"]``
        - A list of dicts / AgentConfig objects: ``[{"agent_name": "extraction", "model_id": "..."}]``
        - Empty / absent → falls back to :data:`DEFAULT_CHAIN`.
        """
        raw_agents = workspace.get("agents") or []

        if not raw_agents:
            return [AgentConfig(agent_name=name) for name in DEFAULT_CHAIN]

        configs: list[AgentConfig] = []
        for item in raw_agents:
            if isinstance(item, str):
                configs.append(AgentConfig(agent_name=item))
            elif isinstance(item, dict):
                configs.append(AgentConfig(**item))
            elif isinstance(item, AgentConfig):
                configs.append(item)
            else:
                configs.append(AgentConfig(agent_name=str(item)))

        return configs if configs else [AgentConfig(agent_name=name) for name in DEFAULT_CHAIN]

    # ── 5.2  _execute_agent with timing & metrics ──────────────────────────

    def _execute_agent(
        self,
        agent_name: str,
        agent: Any,
        input_data: dict[str, Any],
        model_id: str = "none",
        prompt_version: str = "unknown",
    ) -> tuple[Any, AgentStep]:
        """Invoke *agent* with *input_data*, recording an :class:`AgentStep`.

        Wraps the call with start/end timestamps for ``latency_ms`` and
        extracts ``input_tokens`` / ``output_tokens`` from the Strands agent
        metrics.  On error the step is recorded with ``status="error"`` and
        the exception is re-raised so the caller can handle chain termination.
        """
        start = time.time()
        step = AgentStep(
            agent_name=agent_name,
            model_id=model_id,
            prompt_version=prompt_version,
        )
        try:
            result = agent(json.dumps(input_data))
            step.status = "success"

            # Extract token usage from Strands agent metrics
            if hasattr(result, "metrics") and isinstance(result.metrics, dict):
                step.input_tokens = result.metrics.get("inputTokens", 0)
                step.output_tokens = result.metrics.get("outputTokens", 0)

            return result, step
        except Exception as exc:
            step.status = "error"
            step.error_message = str(exc)
            raise
        finally:
            step.latency_ms = round((time.time() - start) * 1000, 2)

    # ── 5.3  run() — sequential agent chain execution ──────────────────────

    def run(self) -> WorkflowResult:
        """Execute the full agent chain and return a :class:`WorkflowResult`."""
        start_time = time.time()
        sm = WorkflowStateMachine(
            self.event.trace_id, initial_state=WorkflowState.submitted
        )

        # Transition to downloading (required before parsing)
        sm.transition(WorkflowState.downloading)

        current_input: dict[str, Any] = {
            "trace_id": self.event.trace_id,
            "workspace_id": self.event.workspace_id,
            "s3_key": self.event.s3_key,
            "filename": self.event.filename,
            "schema": self.event.schema,
            "hitl_threshold": self.event.hitl_threshold,
        }

        confidence: float = 1.0

        try:
            chain_names = [cfg.agent_name for cfg in self._chain]
            factories = _get_agent_factories()

            for cfg in self._chain:
                agent_name = cfg.agent_name
                factory = factories.get(agent_name)
                if factory is None:
                    raise ValueError(
                        f"Unknown agent '{agent_name}'. "
                        f"Valid agents: {list(factories.keys())}"
                    )

                # ── 5.4  Dual-pipeline logic ───────────────────────────────
                if (
                    agent_name == "reconciliation"
                    and "extraction" in chain_names
                ):
                    current_input, confidence = self._run_dual_pipeline(
                        sm, cfg, current_input, confidence
                    )
                    continue

                # Skip standalone extraction when reconciliation handles it
                if (
                    agent_name == "extraction"
                    and "reconciliation" in chain_names
                ):
                    continue

                # Update state machine
                target_state = AGENT_TO_STATE.get(agent_name)
                if target_state:
                    sm.transition(target_state)

                # Load prompt
                prompt_version_req = cfg.prompt_version or self.event.prompt_version
                try:
                    prompt_text, actual_version = self._prompt_registry.get_prompt(
                        agent_name, prompt_version_req
                    )
                except FileNotFoundError as exc:
                    raise ValueError(
                        f"Failed to initialize {agent_name}: {exc}"
                    ) from exc

                self._prompt_versions[agent_name] = actual_version

                # Instantiate agent
                model_id = cfg.model_id  # may be None → factory uses default
                try:
                    agent = factory(system_prompt=prompt_text, model_id=model_id)
                except Exception as exc:
                    raise ValueError(
                        f"Failed to initialize {agent_name}: {exc}"
                    ) from exc

                resolved_model_id = model_id or "default"

                # Execute agent
                result, step = self._execute_agent(
                    agent_name,
                    agent,
                    current_input,
                    model_id=resolved_model_id,
                    prompt_version=actual_version,
                )
                self.agent_steps.append(step)

                # Parse result for next agent
                current_input = self._parse_agent_result(result, current_input)

                # Extract confidence from validation / reconciliation output
                if "confidence" in current_input:
                    confidence = float(current_input["confidence"])

        except ValueError as exc:
            # Agent init / config errors (5.5)
            return self._fail_workflow(
                sm, str(exc), start_time
            )
        except Exception as exc:
            # Agent execution errors — step already recorded in _execute_agent (5.5)
            return self._fail_workflow(
                sm, str(exc), start_time
            )

        # ── Compute totals ─────────────────────────────────────────────────
        total_tokens = sum(
            s.input_tokens + s.output_tokens for s in self.agent_steps
        )
        total_latency = sum(s.latency_ms for s in self.agent_steps)

        # ── Determine final status ─────────────────────────────────────────
        if confidence < self.event.hitl_threshold:
            final_status = "hitl_required"
            sm.transition(WorkflowState.hitl_pending)
        else:
            final_status = "completed"
            sm.transition(WorkflowState.completed)

        return WorkflowResult(
            trace_id=self.event.trace_id,
            workspace_id=self.event.workspace_id,
            status=final_status,
            workflow_state=sm.current_state.value,
            confidence=confidence,
            tokens=total_tokens,
            latency_ms=round(total_latency, 2),
            fields=current_input.get("fields", []) if isinstance(current_input, dict) else [],
            agent_steps=self.agent_steps,
            validation_errors=current_input.get("validation_errors", []) if isinstance(current_input, dict) else [],
        )

    # ── 5.4  Dual-pipeline logic ───────────────────────────────────────────

    def _run_dual_pipeline(
        self,
        sm: WorkflowStateMachine,
        recon_cfg: AgentConfig,
        current_input: dict[str, Any],
        confidence: float,
    ) -> tuple[dict[str, Any], float]:
        """Run extraction twice then reconciliation.

        When ``"reconciliation"`` is in the chain the orchestrator runs
        extraction twice (primary + secondary model) before passing both
        results to the Reconciliation Agent.

        If the secondary extraction fails, reconciliation proceeds with
        only the primary result and confidence is reduced by 0.1.
        """
        # ── Primary extraction ─────────────────────────────────────────────
        primary_result = self._run_single_extraction(
            sm, current_input, model_id_override=None, label="extraction"
        )

        # ── Secondary extraction ───────────────────────────────────────────
        secondary_model_id = self.workspace.get("secondary_model_id")
        secondary_result: dict[str, Any] | None = None
        secondary_failed = False

        try:
            secondary_result = self._run_single_extraction(
                sm,
                current_input,
                model_id_override=secondary_model_id,
                label="extraction",
            )
        except Exception as exc:
            logger.warning(
                "Secondary extraction failed: %s — proceeding with primary only",
                exc,
            )
            secondary_failed = True

        # ── Reconciliation ─────────────────────────────────────────────────
        sm.transition(WorkflowState.reconciling)

        recon_input: dict[str, Any] = {
            **current_input,
            "primary_fields": primary_result.get("fields", primary_result),
            "secondary_fields": (
                secondary_result.get("fields", secondary_result)
                if secondary_result is not None
                else {}
            ),
            "hitl_threshold": self.event.hitl_threshold,
        }

        prompt_version_req = recon_cfg.prompt_version or self.event.prompt_version
        try:
            prompt_text, actual_version = self._prompt_registry.get_prompt(
                "reconciliation", prompt_version_req
            )
        except FileNotFoundError as exc:
            raise ValueError(
                f"Failed to initialize reconciliation: {exc}"
            ) from exc

        self._prompt_versions["reconciliation"] = actual_version

        try:
            recon_agent = create_reconciliation_agent(
                system_prompt=prompt_text, model_id=recon_cfg.model_id
            )
        except Exception as exc:
            raise ValueError(
                f"Failed to initialize reconciliation: {exc}"
            ) from exc

        resolved_model_id = recon_cfg.model_id or "default"
        result, step = self._execute_agent(
            "reconciliation",
            recon_agent,
            recon_input,
            model_id=resolved_model_id,
            prompt_version=actual_version,
        )
        self.agent_steps.append(step)

        output = self._parse_agent_result(result, recon_input)

        # Extract confidence from reconciliation output
        recon_confidence = float(output.get("confidence", confidence))
        if secondary_failed:
            recon_confidence = max(0.0, recon_confidence - 0.1)

        return output, recon_confidence

    def _run_single_extraction(
        self,
        sm: WorkflowStateMachine,
        current_input: dict[str, Any],
        *,
        model_id_override: str | None,
        label: str,
    ) -> dict[str, Any]:
        """Run a single extraction agent pass and record the step."""
        # Only transition to reasoning state for the first extraction
        if sm.current_state != WorkflowState.reasoning:
            sm.transition(WorkflowState.reasoning)

        prompt_version_req = self.event.prompt_version
        try:
            prompt_text, actual_version = self._prompt_registry.get_prompt(
                "extraction", prompt_version_req
            )
        except FileNotFoundError as exc:
            raise ValueError(
                f"Failed to initialize extraction: {exc}"
            ) from exc

        self._prompt_versions["extraction"] = actual_version

        try:
            agent = create_extraction_agent(
                system_prompt=prompt_text, model_id=model_id_override
            )
        except Exception as exc:
            raise ValueError(
                f"Failed to initialize extraction: {exc}"
            ) from exc

        resolved_model_id = model_id_override or "default"
        result, step = self._execute_agent(
            label,
            agent,
            current_input,
            model_id=resolved_model_id,
            prompt_version=actual_version,
        )
        self.agent_steps.append(step)
        return self._parse_agent_result(result, current_input)

    # ── 5.5  Error handling helpers ────────────────────────────────────────

    def _fail_workflow(
        self,
        sm: WorkflowStateMachine,
        error_message: str,
        start_time: float,
    ) -> WorkflowResult:
        """Transition to failed state and return a failed :class:`WorkflowResult`.

        Preserves all prior agent steps.  If the trace update itself fails,
        both the original error and the update error are logged.
        """
        total_latency = sum(s.latency_ms for s in self.agent_steps)
        total_tokens = sum(
            s.input_tokens + s.output_tokens for s in self.agent_steps
        )

        try:
            sm.transition(
                WorkflowState.failed,
                metadata={
                    "error": error_message,
                    "latency": str(round(total_latency, 2)),
                    "agent_steps": [s.model_dump() for s in self.agent_steps],
                },
            )
        except Exception as update_exc:
            logger.error("Original error: %s", error_message)
            logger.error("Trace update failed: %s", update_exc)

        return WorkflowResult(
            trace_id=self.event.trace_id,
            workspace_id=self.event.workspace_id,
            status="failed",
            workflow_state=sm.current_state.value,
            confidence=0.0,
            tokens=total_tokens,
            latency_ms=round(total_latency, 2),
            agent_steps=self.agent_steps,
            error=error_message,
        )

    # ── Helpers ────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_agent_result(
        result: Any, fallback: dict[str, Any]
    ) -> dict[str, Any]:
        """Extract a dict from a Strands agent result.

        The Strands SDK returns a result object whose string representation
        is typically JSON.  We try ``json.loads(str(result))`` first, then
        fall back to the previous input so the chain can continue.
        """
        try:
            text = str(result)
            return json.loads(text)
        except (json.JSONDecodeError, TypeError, ValueError):
            pass

        # If the result has a dict-like interface, use it directly
        if isinstance(result, dict):
            return result

        # Fall back — pass the previous stage's data forward
        return fallback
