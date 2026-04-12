"""Property-based tests for the WorkflowOrchestrator.

Tasks 5.6–5.9: Hypothesis-driven tests verifying orchestrator invariants.
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

from services.workflow.models import (
    AgentConfig,
    AgentStep,
    ProcessingEvent,
    WorkflowResult,
)
from services.workflow.orchestrator import (
    DEFAULT_CHAIN,
    WorkflowOrchestrator,
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

# Agents that don't trigger dual-pipeline complexity
SIMPLE_AGENTS = ["parsing", "extraction", "validation"]

# Patch targets in the orchestrator module namespace
_SM_PATH = "services.workflow.orchestrator.WorkflowStateMachine"
_PR_PATH = "services.workflow.orchestrator.PromptRegistry"
_PARSE_PATH = "services.workflow.orchestrator.create_parsing_agent"
_EXT_PATH = "services.workflow.orchestrator.create_extraction_agent"
_VAL_PATH = "services.workflow.orchestrator.create_validation_agent"
_RECON_PATH = "services.workflow.orchestrator.create_reconciliation_agent"

ALL_FACTORY_PATHS = [_PARSE_PATH, _EXT_PATH, _VAL_PATH, _RECON_PATH]

AGENT_FACTORY_MAP = {
    "parsing": _PARSE_PATH,
    "extraction": _EXT_PATH,
    "validation": _VAL_PATH,
    "reconciliation": _RECON_PATH,
}


def _make_event(**overrides) -> ProcessingEvent:
    defaults = {
        "trace_id": "trace-prop",
        "workspace_id": "ws-prop",
        "s3_key": "docs/test.pdf",
        "filename": "test.pdf",
        "schema": {"field": "string"},
        "hitl_threshold": 0.8,
        "prompt_version": "1.0.0",
    }
    defaults.update(overrides)
    return ProcessingEvent(**defaults)


def _mock_agent_result(output_dict: dict | None = None, metrics: dict | None = None):
    """Create a mock Strands agent result with __str__ returning JSON."""
    if output_dict is None:
        output_dict = {"fields": [], "confidence": 0.95}
    result = MagicMock()
    result.__str__ = MagicMock(return_value=json.dumps(output_dict))
    result.metrics = metrics or {"inputTokens": 100, "outputTokens": 50}
    return result


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Non-empty subsets of simple agents (no reconciliation)
agent_chain_strategy = st.lists(
    st.sampled_from(SIMPLE_AGENTS),
    min_size=1,
    max_size=3,
    unique=True,
)



# ===========================================================================
# 5.6 — Property 1: Agent chain from workspace config determines execution order
# **Validates: Requirements 2.1, 2.3, 4.1, 4.2**
# ===========================================================================

class TestProperty1AgentChainOrder:
    """Property 1: Agent chain from workspace config determines execution order.

    For any non-empty subset of simple agents, the orchestrator should execute
    exactly those agents in the specified order, and the resulting agent_steps
    array should contain entries matching the agent names in the same order.
    """

    @given(chain=agent_chain_strategy)
    @settings(max_examples=100, deadline=None)
    def test_agent_steps_order_matches_config(self, chain: list[str]):
        """**Validates: Requirements 2.1, 2.3, 4.1, 4.2**"""
        event = _make_event()
        ws = {"agents": chain}

        mock_result = _mock_agent_result()

        with (
            patch(_SM_PATH) as mock_sm_cls,
            patch(_PR_PATH) as mock_pr_cls,
            patch(_PARSE_PATH) as mock_parse,
            patch(_EXT_PATH) as mock_ext,
            patch(_VAL_PATH) as mock_val,
            patch(_RECON_PATH) as mock_recon,
        ):
            # State machine mock
            mock_sm = MagicMock()
            mock_sm.current_state.value = "completed"
            mock_sm_cls.return_value = mock_sm

            # Prompt registry mock
            mock_pr = MagicMock()
            mock_pr.get_prompt.return_value = ("prompt text", "1.0.0")
            mock_pr_cls.return_value = mock_pr

            # All factories return a callable that returns a valid result
            for factory_mock in [mock_parse, mock_ext, mock_val, mock_recon]:
                factory_mock.return_value = MagicMock(return_value=mock_result)

            orch = WorkflowOrchestrator(event, ws)
            result = orch.run()

        # The agent_steps names must match the chain order exactly
        step_names = [s.agent_name for s in result.agent_steps]
        assert step_names == chain, (
            f"Expected agent_steps order {chain}, got {step_names}"
        )



# ===========================================================================
# 5.7 — Property 2: Default agent chain is used when workspace agents is empty
# **Validates: Requirements 2.2**
# ===========================================================================

class TestProperty2DefaultChain:
    """Property 2: Default agent chain is used when workspace agents is empty.

    For any workspace with an empty or absent agents field, the orchestrator
    should resolve the default chain ["parsing", "extraction", "reconciliation",
    "validation"].
    """

    # Strategy: random workspace dicts with empty/absent agents
    @given(
        ws=st.one_of(
            # agents key absent entirely
            st.fixed_dictionaries({}),
            # agents key present but empty list
            st.fixed_dictionaries({"agents": st.just([])}),
            # agents key present but None
            st.fixed_dictionaries({"agents": st.none()}),
            # extra random keys, agents still empty
            st.fixed_dictionaries(
                {"agents": st.just([])},
                optional={"some_key": st.text(min_size=0, max_size=5)},
            ),
        )
    )
    @settings(max_examples=100, deadline=None)
    def test_default_chain_resolved(self, ws: dict):
        """**Validates: Requirements 2.2**"""
        # Pure logic test — no mocking needed, just test _resolve_chain
        chain = WorkflowOrchestrator._resolve_chain(ws)
        chain_names = [c.agent_name for c in chain]
        assert chain_names == DEFAULT_CHAIN, (
            f"Expected default chain {DEFAULT_CHAIN}, got {chain_names}"
        )



# ===========================================================================
# 5.8 — Property 10: Agent failure stops chain and preserves prior steps
# **Validates: Requirements 2.5, 7.1, 7.3**
# ===========================================================================

class TestProperty10AgentFailureStopsChain:
    """Property 10: Agent failure stops chain and preserves prior steps.

    For any chain of 2-4 agents (no reconciliation) and any failure position,
    agents after the failure should not execute, prior steps should be
    preserved, and the workflow status should be "failed".
    """

    @given(
        data=st.data(),
    )
    @settings(max_examples=100, deadline=None)
    def test_failure_stops_chain_preserves_prior(self, data):
        """**Validates: Requirements 2.5, 7.1, 7.3**"""
        # Generate a chain of 2-4 unique simple agents
        chain = data.draw(
            st.lists(
                st.sampled_from(SIMPLE_AGENTS),
                min_size=2,
                max_size=3,
                unique=True,
            )
        )
        # Pick a failure position (0 to len-1)
        fail_pos = data.draw(st.integers(min_value=0, max_value=len(chain) - 1))

        event = _make_event()
        ws = {"agents": chain}

        success_result = _mock_agent_result()

        with (
            patch(_SM_PATH) as mock_sm_cls,
            patch(_PR_PATH) as mock_pr_cls,
            patch(_PARSE_PATH) as mock_parse,
            patch(_EXT_PATH) as mock_ext,
            patch(_VAL_PATH) as mock_val,
            patch(_RECON_PATH) as mock_recon,
        ):
            mock_sm = MagicMock()
            mock_sm.current_state.value = "failed"
            mock_sm_cls.return_value = mock_sm

            mock_pr = MagicMock()
            mock_pr.get_prompt.return_value = ("prompt text", "1.0.0")
            mock_pr_cls.return_value = mock_pr

            # Build per-agent mock behavior: agents before fail_pos succeed,
            # agent at fail_pos raises, agents after should never be called.
            factory_mocks = {
                "parsing": mock_parse,
                "extraction": mock_ext,
                "validation": mock_val,
                "reconciliation": mock_recon,
            }

            for idx, agent_name in enumerate(chain):
                factory = factory_mocks[agent_name]
                if idx < fail_pos:
                    # Agent succeeds — the mock agent callable returns success_result
                    mock_agent = MagicMock(return_value=success_result)
                    factory.return_value = mock_agent
                elif idx == fail_pos:
                    # Agent fails — the mock agent callable raises
                    mock_agent = MagicMock(
                        side_effect=RuntimeError(f"Agent {agent_name} failed")
                    )
                    factory.return_value = mock_agent
                else:
                    # Should not be called
                    mock_agent = MagicMock(return_value=success_result)
                    factory.return_value = mock_agent

            orch = WorkflowOrchestrator(event, ws)
            result = orch.run()

        # Workflow status must be "failed"
        assert result.status == "failed", (
            f"Expected status 'failed', got '{result.status}'"
        )

        # Prior steps (before failure) should be preserved with status "success"
        for i in range(fail_pos):
            assert i < len(result.agent_steps), (
                f"Expected agent_step at index {i} for '{chain[i]}' to be preserved"
            )
            assert result.agent_steps[i].agent_name == chain[i]
            assert result.agent_steps[i].status == "success"

        # Agents after the failure position should NOT appear in agent_steps
        step_names = [s.agent_name for s in result.agent_steps]
        for after_name in chain[fail_pos + 1:]:
            # The after-failure agents should not have successful steps
            after_steps = [s for s in result.agent_steps if s.agent_name == after_name and s.status == "success"]
            assert len(after_steps) == 0, (
                f"Agent '{after_name}' should not have executed after failure at position {fail_pos}"
            )



# ===========================================================================
# 5.9 — Property 9: Prompt version in agent step matches actual version used
# **Validates: Requirements 5.4**
# ===========================================================================

class TestProperty9PromptVersionInStep:
    """Property 9: Prompt version in agent step matches actual version used.

    For any agent execution with prompt fallback scenarios, the prompt_version
    recorded in the AgentStep should match the actual_version returned by the
    PromptRegistry (which may differ from the requested version if fallback
    occurred).
    """

    @given(
        agent_name=st.sampled_from(SIMPLE_AGENTS),
        requested_version=st.from_regex(r"[0-9]+\.[0-9]+\.[0-9]+", fullmatch=True),
        actual_version=st.from_regex(r"[0-9]+\.[0-9]+\.[0-9]+", fullmatch=True),
    )
    @settings(max_examples=100, deadline=None)
    def test_step_prompt_version_matches_registry(
        self, agent_name: str, requested_version: str, actual_version: str
    ):
        """**Validates: Requirements 5.4**"""
        event = _make_event(prompt_version=requested_version)
        ws = {"agents": [agent_name]}

        mock_result = _mock_agent_result()

        with (
            patch(_SM_PATH) as mock_sm_cls,
            patch(_PR_PATH) as mock_pr_cls,
            patch(_PARSE_PATH) as mock_parse,
            patch(_EXT_PATH) as mock_ext,
            patch(_VAL_PATH) as mock_val,
            patch(_RECON_PATH) as mock_recon,
        ):
            mock_sm = MagicMock()
            mock_sm.current_state.value = "completed"
            mock_sm_cls.return_value = mock_sm

            # PromptRegistry returns the actual_version (may differ from requested)
            mock_pr = MagicMock()
            mock_pr.get_prompt.return_value = ("prompt text", actual_version)
            mock_pr_cls.return_value = mock_pr

            for factory_mock in [mock_parse, mock_ext, mock_val, mock_recon]:
                factory_mock.return_value = MagicMock(return_value=mock_result)

            orch = WorkflowOrchestrator(event, ws)
            result = orch.run()

        # There should be exactly one agent step
        assert len(result.agent_steps) == 1, (
            f"Expected 1 agent step, got {len(result.agent_steps)}"
        )

        step = result.agent_steps[0]
        assert step.agent_name == agent_name
        # The key property: step.prompt_version must match the actual_version
        # returned by PromptRegistry, NOT the requested version
        assert step.prompt_version == actual_version, (
            f"Expected prompt_version '{actual_version}' (actual from registry), "
            f"got '{step.prompt_version}'"
        )
