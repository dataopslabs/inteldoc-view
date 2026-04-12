"""Dual-pipeline reconciliation tests.

Tasks 7.2–7.4:
- Property 7: Reconciliation confidence rules are consistent
- Property 12: Secondary extraction failure degrades gracefully
- Unit tests for dual-pipeline orchestration
"""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

from services.workflow.agents.reconciliation import reconcile_fields
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

_SM_PATH = "services.workflow.orchestrator.WorkflowStateMachine"
_PR_PATH = "services.workflow.orchestrator.PromptRegistry"
_PARSE_PATH = "services.workflow.orchestrator.create_parsing_agent"
_EXT_PATH = "services.workflow.orchestrator.create_extraction_agent"
_VAL_PATH = "services.workflow.orchestrator.create_validation_agent"
_RECON_PATH = "services.workflow.orchestrator.create_reconciliation_agent"


def _make_event(**overrides) -> ProcessingEvent:
    defaults = {
        "trace_id": "trace-dual",
        "workspace_id": "ws-dual",
        "s3_key": "docs/test.pdf",
        "filename": "test.pdf",
        "schema": {"field": "string"},
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
    """Create a mock Strands agent result with __str__ returning JSON."""
    result = MagicMock()
    result.__str__ = MagicMock(return_value=json.dumps(output_dict))
    result.metrics = metrics or {"inputTokens": 100, "outputTokens": 50}
    return result



# ===========================================================================
# 7.2 — Property 7: Reconciliation confidence rules are consistent
# **Validates: Requirements 3.3, 3.4, 3.5**
# ===========================================================================

# Strategy: generate field dicts with string keys and string values
_field_values = st.text(min_size=1, max_size=20, alphabet=st.characters(whitelist_categories=("L", "N")))
_field_dict = st.dictionaries(
    keys=st.text(min_size=1, max_size=10, alphabet=st.characters(whitelist_categories=("L",))),
    values=_field_values,
    min_size=0,
    max_size=5,
)


class TestProperty7ReconciliationConfidence:
    """Property 7: Reconciliation confidence rules are consistent.

    For any pair of extraction results:
    - agreement → confidence 1.0
    - disagreement → reduced confidence (0.5)
    - single value → confidence 0.7
    """

    @given(primary=_field_dict, secondary=_field_dict)
    @settings(max_examples=200, deadline=None)
    def test_confidence_rules_hold(self, primary: dict, secondary: dict):
        """**Validates: Requirements 3.3, 3.4, 3.5**"""
        # Need at least one field to test
        assume(len(primary) > 0 or len(secondary) > 0)

        result = reconcile_fields(
            primary_fields=primary,
            secondary_fields=secondary,
            hitl_threshold=0.8,
        )

        assert "fields" in result
        assert "confidence" in result
        assert "conflicts" in result

        for field_rec in result["fields"]:
            key = field_rec["field_name"]
            in_primary = key in primary
            in_secondary = key in secondary

            if in_primary and in_secondary:
                if primary[key] == secondary[key]:
                    # Agreement → 1.0
                    assert field_rec["confidence"] == 1.0, (
                        f"Field '{key}': both agree on '{primary[key]}' "
                        f"but confidence is {field_rec['confidence']}, expected 1.0"
                    )
                    assert field_rec["conflict"] is False
                else:
                    # Disagreement → 0.5
                    assert field_rec["confidence"] == 0.5, (
                        f"Field '{key}': primary='{primary[key]}', secondary='{secondary[key]}' "
                        f"but confidence is {field_rec['confidence']}, expected 0.5"
                    )
                    assert field_rec["conflict"] is True
                    assert key in result["conflicts"]
            else:
                # Only one has a value → 0.7
                assert field_rec["confidence"] == 0.7, (
                    f"Field '{key}': only in {'primary' if in_primary else 'secondary'} "
                    f"but confidence is {field_rec['confidence']}, expected 0.7"
                )
                assert field_rec["conflict"] is False

    @given(fields=_field_dict)
    @settings(max_examples=100, deadline=None)
    def test_identical_fields_all_confidence_one(self, fields: dict):
        """When both extractions produce identical fields, all confidences are 1.0.

        **Validates: Requirements 3.3**
        """
        assume(len(fields) > 0)

        result = reconcile_fields(
            primary_fields=fields,
            secondary_fields=fields,
            hitl_threshold=0.8,
        )

        assert result["confidence"] == 1.0
        assert result["conflicts"] == []
        for field_rec in result["fields"]:
            assert field_rec["confidence"] == 1.0

    @given(primary=_field_dict)
    @settings(max_examples=100, deadline=None)
    def test_single_source_confidence_point_seven(self, primary: dict):
        """When secondary is empty, all fields get confidence 0.7.

        **Validates: Requirements 3.5**
        """
        assume(len(primary) > 0)

        result = reconcile_fields(
            primary_fields=primary,
            secondary_fields={},
            hitl_threshold=0.8,
        )

        assert result["confidence"] == pytest.approx(0.7)
        for field_rec in result["fields"]:
            assert field_rec["confidence"] == 0.7

    def test_empty_fields_returns_confidence_one(self):
        """Edge case: both empty → overall confidence 1.0."""
        result = reconcile_fields(
            primary_fields={},
            secondary_fields={},
            hitl_threshold=0.8,
        )
        assert result["confidence"] == 1.0
        assert result["fields"] == []
        assert result["conflicts"] == []



# ===========================================================================
# 7.3 — Property 12: Secondary extraction failure degrades gracefully
# **Validates: Requirements 3.6**
# ===========================================================================

# Strategy: generate primary extraction results with field dicts
_extraction_fields = st.dictionaries(
    keys=st.text(min_size=1, max_size=8, alphabet=st.characters(whitelist_categories=("L",))),
    values=st.text(min_size=1, max_size=15, alphabet=st.characters(whitelist_categories=("L", "N"))),
    min_size=1,
    max_size=5,
)

_confidence_values = st.floats(min_value=0.2, max_value=1.0, allow_nan=False, allow_infinity=False)


class TestProperty12SecondaryFailureDegradation:
    """Property 12: Secondary extraction failure degrades gracefully.

    When the secondary extraction fails, the orchestrator proceeds with
    primary-only results and reduces overall confidence by 0.1.
    """

    @given(
        primary_fields=_extraction_fields,
        base_confidence=_confidence_values,
    )
    @settings(max_examples=100, deadline=None)
    def test_secondary_failure_reduces_confidence_by_point_one(
        self, primary_fields: dict, base_confidence: float
    ):
        """**Validates: Requirements 3.6**"""
        # The reconciliation agent returns a confidence value.
        # When secondary fails, the orchestrator subtracts 0.1 from it.
        recon_output = {
            "fields": [{"field_name": k, "value": v} for k, v in primary_fields.items()],
            "confidence": base_confidence,
            "conflicts": [],
        }

        recon_result = _mock_agent_result(recon_output)
        primary_ext_result = _mock_agent_result({"fields": primary_fields, "confidence": 0.9})

        # Track extraction call count to fail the second call
        call_count = [0]

        def ext_side_effect(input_str):
            call_count[0] += 1
            if call_count[0] == 1:
                return primary_ext_result
            raise RuntimeError("Secondary model unavailable")

        with (
            patch(_SM_PATH) as mock_sm_cls,
            patch(_PR_PATH) as mock_pr_cls,
            patch(_EXT_PATH) as mock_ext,
            patch(_RECON_PATH) as mock_recon,
        ):
            mock_sm = MagicMock()
            mock_sm.current_state.value = "completed"
            mock_sm_cls.return_value = mock_sm

            mock_pr = MagicMock()
            mock_pr.get_prompt.return_value = ("prompt text", "1.0.0")
            mock_pr_cls.return_value = mock_pr

            mock_ext.return_value = MagicMock(side_effect=ext_side_effect)
            mock_recon.return_value = MagicMock(return_value=recon_result)

            event = _make_event()
            ws = _make_workspace(agents=["extraction", "reconciliation"])
            orch = WorkflowOrchestrator(event, ws)
            result = orch.run()

        expected_confidence = max(0.0, base_confidence - 0.1)
        assert result.confidence == pytest.approx(expected_confidence, abs=0.001), (
            f"Expected confidence {expected_confidence} "
            f"(base {base_confidence} - 0.1), got {result.confidence}"
        )



# ===========================================================================
# 7.4 — Unit tests for dual-pipeline orchestration
# **Requirements: 3.1, 3.6, 3.7**
# ===========================================================================


class TestDualPipelineUnit:
    """Unit tests for dual-pipeline orchestration."""

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_EXT_PATH)
    @patch(_RECON_PATH)
    def test_dual_extraction_with_two_model_ids(
        self, mock_recon, mock_ext, mock_pr_cls, mock_sm_cls
    ):
        """Dual extraction uses primary and secondary model IDs.

        Requirements: 3.1
        """
        mock_sm = MagicMock()
        mock_sm.current_state.value = "completed"
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.return_value = ("prompt", "1.0.0")
        mock_pr_cls.return_value = mock_pr

        ext_result = _mock_agent_result({"fields": {"name": "Alice"}, "confidence": 0.9})
        recon_result = _mock_agent_result(
            {"fields": [{"field_name": "name", "value": "Alice"}], "confidence": 0.95}
        )

        mock_ext.return_value = MagicMock(return_value=ext_result)
        mock_recon.return_value = MagicMock(return_value=recon_result)

        event = _make_event()
        ws = _make_workspace(
            agents=["extraction", "reconciliation"],
            secondary_model_id="anthropic.claude-3-sonnet-20240229-v1:0",
        )
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        # Should have 2 extraction steps + 1 reconciliation step
        extraction_steps = [s for s in result.agent_steps if s.agent_name == "extraction"]
        recon_steps = [s for s in result.agent_steps if s.agent_name == "reconciliation"]
        assert len(extraction_steps) == 2
        assert len(recon_steps) == 1

        # The extraction factory should have been called twice with different model_ids
        assert mock_ext.call_count == 2
        first_call_model = mock_ext.call_args_list[0].kwargs.get("model_id")
        second_call_model = mock_ext.call_args_list[1].kwargs.get("model_id")
        # Second call should use the secondary model
        assert second_call_model == "anthropic.claude-3-sonnet-20240229-v1:0"

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_EXT_PATH)
    @patch(_RECON_PATH)
    def test_secondary_timeout_proceeds_with_primary_only(
        self, mock_recon, mock_ext, mock_pr_cls, mock_sm_cls
    ):
        """When secondary extraction times out, reconciliation proceeds with primary only.

        Requirements: 3.6
        """
        mock_sm = MagicMock()
        mock_sm.current_state.value = "completed"
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.return_value = ("prompt", "1.0.0")
        mock_pr_cls.return_value = mock_pr

        primary_result = _mock_agent_result({"fields": {"name": "Bob"}, "confidence": 0.9})
        recon_result = _mock_agent_result(
            {"fields": [{"field_name": "name", "value": "Bob"}], "confidence": 0.85}
        )

        call_count = [0]

        def ext_side_effect(input_str):
            call_count[0] += 1
            if call_count[0] == 1:
                return primary_result
            raise TimeoutError("Secondary extraction timed out")

        mock_ext.return_value = MagicMock(side_effect=ext_side_effect)
        mock_recon.return_value = MagicMock(return_value=recon_result)

        event = _make_event()
        ws = _make_workspace(agents=["extraction", "reconciliation"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        # Should not be failed — graceful degradation
        assert result.status != "failed"
        # Confidence should be reduced by 0.1 from the recon output
        assert result.confidence == pytest.approx(0.75, abs=0.01)

        # Reconciliation agent should have been called with empty secondary_fields
        recon_agent_mock = mock_recon.return_value
        assert recon_agent_mock.call_count == 1

    @patch(_SM_PATH)
    @patch(_PR_PATH)
    @patch(_EXT_PATH)
    def test_chain_without_reconciliation_runs_extraction_once(
        self, mock_ext, mock_pr_cls, mock_sm_cls
    ):
        """Without reconciliation in chain, extraction runs only once.

        Requirements: 3.7
        """
        mock_sm = MagicMock()
        mock_sm.current_state.value = "completed"
        mock_sm_cls.return_value = mock_sm

        mock_pr = MagicMock()
        mock_pr.get_prompt.return_value = ("prompt", "1.0.0")
        mock_pr_cls.return_value = mock_pr

        ext_result = _mock_agent_result({"fields": [{"name": "Charlie"}], "confidence": 0.95})
        mock_ext.return_value = MagicMock(return_value=ext_result)

        event = _make_event()
        ws = _make_workspace(agents=["extraction"])
        orch = WorkflowOrchestrator(event, ws)
        result = orch.run()

        # Only one extraction step
        extraction_steps = [s for s in result.agent_steps if s.agent_name == "extraction"]
        assert len(extraction_steps) == 1

        # The extraction factory should have been called exactly once
        assert mock_ext.call_count == 1

        # No reconciliation steps
        recon_steps = [s for s in result.agent_steps if s.agent_name == "reconciliation"]
        assert len(recon_steps) == 0
