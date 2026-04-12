"""Unit tests for the WorkflowOrchestrator.

Covers Tasks 5.1–5.5:
- Chain resolution from workspace config
- _execute_agent timing and metric collection
- run() sequential execution
- Dual-pipeline logic
- Error handling
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from services.workflow.models import (
    AgentConfig,
    AgentStep,
    ProcessingEvent,
    WorkflowResult,
)
from services.workflow.orchestrator import (
    DEFAULT_CHAIN,
    _get_agent_factories,
    AGENT_TO_STATE,
    WorkflowOrchestrator,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_event(**overrides) -> ProcessingEvent:
    defaults = {
        "trace_id": "trace-001",
        "workspace_id": "ws-001",
        "s3_key": "docs/test.pdf",
        "filename": "test.pdf",
        "schema": {"invoice_number": "string"},
        "hitl_threshold": 0.8,
        "prompt_version": "1.0.0",
    }
    defaults.update(overrides)
    return ProcessingEvent(**defaults)


def _make_workspace(**overrides) -> dict:
    defaults: dict = {"agents": [], "secondary_model_id": None}
    defaults.update(overrides)
    return defaults


def _mock_agent_result(output_dict: dict, metrics: dict | None = None):
    """Create a mock Strands agent result."""
    result = MagicMock()
    result.__str__ = MagicMock(return_value=json.dumps(output_dict))
    if metrics is not None:
        result.metrics = metrics
    else:
        result.metrics = {"inputTokens": 100, "outputTokens": 50}
    return result


# Patch targets — all in the orchestrator module namespace
_SM_PATH = "services.workflow.orchestrator.WorkflowStateMachine"
_PR_PATH = "services.workflow.orchestrator.PromptRegistry"
_PARSE_PATH = "services.workflow.orchestrator.create_parsing_agent"
_EXT_PATH = "services.workflow.orchestrator.create_extraction_agent"
_VAL_PATH = "services.workflow.orchestrator.create_validation_agent"
_RECON_PATH = "services.workflow.orchestrator.create_reconciliation_agent"


# ===========================================================================
# 5.1 — Chain resolution tests (no mocking needed — pure logic)
# ===========================================================================

class TestChainResolution:
    """Task 5.1: __init__ and chain resolution."""

    def test_default_chain_when_agents_empty(self):
        event = _make_event()
        ws = _make_workspace(agents=[])
        orch = WorkflowOrchestrator(event, ws)
        assert [c.agent_name for c in orch._chain] == DEFAULT_CHAIN

    def test_default_chain_when_agents_absent(self):
        event = _make_event()
        orch = WorkflowOrchestrator(event, {})
        assert [c.agent_name for c in orch._chain] == DEFAULT_CHAIN

    def test_string_list_agents(self):
        event = _make_event()
        ws = _make_workspace(agents=["parsing", "validation"])
        orch = WorkflowOrchestrator(event, ws)
        assert [c.agent_name for c in orch._chain] == ["parsing", "validation"]
        assert all(c.model_id is None for c in orch._chain)

    def test_dict_list_agents(self):
        event = _make_event()
        ws = _make_workspace(agents=[
            {"agent_name": "extraction", "model_id": "custom-model"},
            {"agent_name": "validation"},
        ])
        orch = WorkflowOrchestrator(event, ws)
        assert orch._chain[0].agent_name == "extraction"
        assert orch._chain[0].model_id == "custom-model"
        assert orch._chain[1].agent_name == "validation"
        assert orch._chain[1].model_id is None

    def test_mixed_string_and_dict_agents(self):
        event = _make_event()
        ws = _make_workspace(agents=[
            "parsing",
            {"agent_name": "extraction", "model_id": "m1"},
        ])
        orch = WorkflowOrchestrator(event, ws)
        assert orch._chain[0].agent_name == "parsing"
        assert orch._chain[1].model_id == "m1"

    def test_agent_factories_mapping(self):
        factories = _get_agent_factories()
        for name in DEFAULT_CHAIN:
            assert name in factories

    def test_agent_to_state_mapping(self):
        for name in DEFAULT_CHAIN:
            assert name in AGENT_TO_STATE


# ===========================================================================
# 5.2 — _execute_agent tests
# ===========================================================================

class TestExecuteAgent:
    """Task 5.2: _execute_agent with timing and metric collection."""

    def test_success_records_step(self):
        event = _make_event()
        orch = WorkflowOrchestrator(event, _make_workspace())

        mock_result = _mock_agent_result(
            {"fields": []}, {"inputTokens": 200, "outputTokens": 80}
        )
        mock_agent = MagicMock(return_value=mock_result)

        result, step = orch._execute_agent(
            "parsing", mock_agent, {"data": "test"},
            model_id="test-model", prompt_version="1.0.0",
        )
        assert step.status == "success"
        assert step.agent_name == "parsing"
        assert step.model_id == "test-model"
        assert step.input_tokens == 200
        assert step.output_tokens == 80
        assert step.latency_ms > 0
        assert step.error_message is None

    def test_error_records_step_and_reraises(self):
        event = _make_event()
        orch = WorkflowOrchestrator(event, _make_workspace())
        mock_agent = MagicMock(side_effect=RuntimeError("boom"))

        with pytest.raises(RuntimeError, match="boom"):
            orch._execute_agent(
                "extraction", mock_agent, {},
                model_id="m1", prompt_version="1.0.0",
            )

    def test_metrics_extraction_from_result(self):
        event = _make_event()
        orch = WorkflowOrchestrator(event, _make_workspace())

        mock_result = _mock_agent_result(
            {"output": "data"}, {"inputTokens": 500, "outputTokens": 250}
        )
        mock_agent = MagicMock(return_value=mock_result)

        _, step = orch._execute_agent(
            "extraction", mock_agent, {},
            model_id="m", prompt_version="1.0.0",
        )
        assert step.input_tokens == 500
        assert step.output_tokens == 250


# ===========================================================================
# 5.3 — run() sequential execution tests
# ===========================================================================

class TestRunMethod:
    """Task 5.3: run() with sequential agent chain execution."""

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_PARSE_PATH)
    @patch(_VAL_PATH)
    def test_simple_chain_executes_in_order(
        self, mock_val_factory, mock_parse_factory, mock_registry_cls, mock_sm_cls
    ):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "completed"
        mock_sm_cls.return_value = mock_sm

        mock_registry = MagicMock()
        mock_registry.get_prompt.return_value = ("prompt text", "1.0.0")
        mock_registry_cls.return_value = mock_registry

        parse_result = _mock_agent_result({"fields": [], "confidence": 0.95})
        val_result = _mock_agent_result({"fields": [], "confidence": 0.95})
        mock_parse_factory.return_value = MagicMock(return_value=parse_result)
        mock_val_factory.return_value = MagicMock(return_value=val_result)

        event = _make_event()
        ws = _make_workspace(agents=["parsing", "validation"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        assert len(orch.agent_steps) == 2
        assert orch.agent_steps[0].agent_name == "parsing"
        assert orch.agent_steps[1].agent_name == "validation"

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_PARSE_PATH)
    def test_hitl_required_when_low_confidence(
        self, mock_parse_factory, mock_registry_cls, mock_sm_cls
    ):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "hitl_pending"
        mock_sm_cls.return_value = mock_sm

        mock_registry = MagicMock()
        mock_registry.get_prompt.return_value = ("prompt", "1.0.0")
        mock_registry_cls.return_value = mock_registry

        low_conf_result = _mock_agent_result({"confidence": 0.3})
        mock_parse_factory.return_value = MagicMock(return_value=low_conf_result)

        event = _make_event(hitl_threshold=0.8)
        ws = _make_workspace(agents=["parsing"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        assert result.status == "hitl_required"

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_PARSE_PATH)
    def test_total_tokens_computed(
        self, mock_parse_factory, mock_registry_cls, mock_sm_cls
    ):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "completed"
        mock_sm_cls.return_value = mock_sm

        mock_registry = MagicMock()
        mock_registry.get_prompt.return_value = ("prompt", "1.0.0")
        mock_registry_cls.return_value = mock_registry

        result_obj = _mock_agent_result(
            {"confidence": 0.95}, {"inputTokens": 100, "outputTokens": 50}
        )
        mock_parse_factory.return_value = MagicMock(return_value=result_obj)

        event = _make_event()
        ws = _make_workspace(agents=["parsing"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        assert result.tokens == 150  # 100 + 50


# ===========================================================================
# 5.4 — Dual-pipeline tests
# ===========================================================================

class TestDualPipeline:
    """Task 5.4: Dual-pipeline logic."""

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_PARSE_PATH)
    @patch(_EXT_PATH)
    @patch(_RECON_PATH)
    @patch(_VAL_PATH)
    def test_dual_pipeline_runs_extraction_twice(
        self, mock_val, mock_recon, mock_ext, mock_parse, mock_pr_cls, mock_sm_cls
    ):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "completed"
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.return_value = ("prompt", "1.0.0")
        mock_pr_cls.return_value = mock_pr

        parse_result = _mock_agent_result({"fields": [], "confidence": 1.0})
        ext_result = _mock_agent_result({"fields": [{"f": "v"}], "confidence": 0.9})
        recon_result = _mock_agent_result({"fields": [{"f": "v"}], "confidence": 0.95})
        val_result = _mock_agent_result({"fields": [{"f": "v"}], "confidence": 0.95})

        mock_parse.return_value = MagicMock(return_value=parse_result)
        mock_ext.return_value = MagicMock(return_value=ext_result)
        mock_recon.return_value = MagicMock(return_value=recon_result)
        mock_val.return_value = MagicMock(return_value=val_result)

        event = _make_event()
        ws = _make_workspace(
            agents=["parsing", "extraction", "reconciliation", "validation"]
        )
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        extraction_steps = [s for s in orch.agent_steps if s.agent_name == "extraction"]
        assert len(extraction_steps) == 2

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_EXT_PATH)
    @patch(_RECON_PATH)
    def test_secondary_failure_reduces_confidence(
        self, mock_recon, mock_ext, mock_pr_cls, mock_sm_cls
    ):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "completed"
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.return_value = ("prompt", "1.0.0")
        mock_pr_cls.return_value = mock_pr

        primary_result = _mock_agent_result({"fields": [{"f": "v"}], "confidence": 0.9})
        recon_result = _mock_agent_result({"fields": [{"f": "v"}], "confidence": 0.9})

        call_count = [0]
        def ext_side_effect(input_str):
            call_count[0] += 1
            if call_count[0] == 1:
                return primary_result
            raise RuntimeError("Secondary model unavailable")

        mock_ext_agent = MagicMock(side_effect=ext_side_effect)
        mock_ext.return_value = mock_ext_agent
        mock_recon.return_value = MagicMock(return_value=recon_result)

        event = _make_event()
        ws = _make_workspace(agents=["extraction", "reconciliation"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        assert result.confidence == pytest.approx(0.8, abs=0.01)

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_EXT_PATH)
    def test_no_reconciliation_runs_extraction_once(
        self, mock_ext, mock_pr_cls, mock_sm_cls
    ):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "completed"
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.return_value = ("prompt", "1.0.0")
        mock_pr_cls.return_value = mock_pr

        ext_result = _mock_agent_result({"fields": [], "confidence": 0.95})
        mock_ext.return_value = MagicMock(return_value=ext_result)

        event = _make_event()
        ws = _make_workspace(agents=["extraction"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        extraction_steps = [s for s in orch.agent_steps if s.agent_name == "extraction"]
        assert len(extraction_steps) == 1


# ===========================================================================
# 5.5 — Error handling tests
# ===========================================================================

class TestErrorHandling:
    """Task 5.5: Error handling in orchestrator."""

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    def test_unknown_agent_fails_trace(self, mock_pr_cls, mock_sm_cls):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "failed"
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.return_value = ("prompt", "1.0.0")
        mock_pr_cls.return_value = mock_pr

        event = _make_event()
        ws = _make_workspace(agents=["nonexistent_agent"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        assert result.status == "failed"
        assert "Unknown agent" in result.error

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    def test_prompt_not_found_fails_trace(self, mock_pr_cls, mock_sm_cls):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "failed"
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.side_effect = FileNotFoundError("No prompt")
        mock_pr_cls.return_value = mock_pr

        event = _make_event()
        ws = _make_workspace(agents=["parsing"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        assert result.status == "failed"
        assert "Failed to initialize" in result.error

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_PARSE_PATH)
    def test_agent_init_error_fails_trace(
        self, mock_parse, mock_pr_cls, mock_sm_cls
    ):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "failed"
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.return_value = ("prompt", "1.0.0")
        mock_pr_cls.return_value = mock_pr

        mock_parse.side_effect = RuntimeError("Invalid model")

        event = _make_event()
        ws = _make_workspace(agents=["parsing"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        assert result.status == "failed"
        assert "Failed to initialize" in result.error

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_PARSE_PATH)
    @patch(_VAL_PATH)
    def test_agent_execution_error_preserves_prior_steps(
        self, mock_val, mock_parse, mock_pr_cls, mock_sm_cls
    ):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "failed"
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.return_value = ("prompt", "1.0.0")
        mock_pr_cls.return_value = mock_pr

        parse_result = _mock_agent_result({"fields": [], "confidence": 0.9})
        mock_parse.return_value = MagicMock(return_value=parse_result)
        mock_val.return_value = MagicMock(side_effect=RuntimeError("Validation crashed"))

        event = _make_event()
        ws = _make_workspace(agents=["parsing", "validation"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        assert result.status == "failed"
        assert len(result.agent_steps) >= 1
        assert result.agent_steps[0].agent_name == "parsing"
        assert result.agent_steps[0].status == "success"

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    def test_trace_update_failure_logs_both_errors(self, mock_pr_cls, mock_sm_cls):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "failed"
        # downloading succeeds, failed transition raises
        mock_sm.transition.side_effect = [
            None,  # downloading
            RuntimeError("DynamoDB write failed"),  # failed transition
        ]
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.side_effect = FileNotFoundError("No prompt")
        mock_pr_cls.return_value = mock_pr

        event = _make_event()
        ws = _make_workspace(agents=["parsing"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        assert result.status == "failed"

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_PARSE_PATH)
    def test_failed_trace_has_latency(self, mock_parse, mock_pr_cls, mock_sm_cls):
        mock_sm = MagicMock()
        mock_sm.current_state.value = "failed"
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.return_value = ("prompt", "1.0.0")
        mock_pr_cls.return_value = mock_pr

        mock_parse.return_value = MagicMock(side_effect=RuntimeError("Agent crashed"))

        event = _make_event()
        ws = _make_workspace(agents=["parsing"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        assert result.status == "failed"
        assert isinstance(result.latency_ms, float)
