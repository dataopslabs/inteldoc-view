"""Unit tests for the workflow handler Lambda entry point.

Covers Task 8.3:
- Handler delegates to WorkflowOrchestrator with correct event payload
- Response shape matches Phase 2 format
- DynamoDB workspace read and orchestrator are mocked
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.workflow.models import AgentStep, WorkflowResult


# Patch targets in the handler module namespace
_LOAD_WS = "services.workflow.handler._load_workspace"
_ORCH_CLS = "services.workflow.handler.WorkflowOrchestrator"
_PROC_EVT = "services.workflow.handler.ProcessingEvent"


def _sample_event(**overrides) -> dict:
    defaults = {
        "trace_id": "trace-100",
        "workspace_id": "ws-200",
        "s3_key": "uploads/invoice.pdf",
        "filename": "invoice.pdf",
        "schema": {"amount": "number"},
        "hitl_threshold": 0.8,
        "prompt_version": "1.0.0",
    }
    defaults.update(overrides)
    return defaults


def _sample_workspace(**overrides) -> dict:
    defaults = {
        "workspace_id": "ws-200",
        "agents": ["parsing", "extraction", "validation"],
        "secondary_model_id": None,
    }
    defaults.update(overrides)
    return defaults


def _sample_workflow_result(**overrides) -> WorkflowResult:
    defaults = {
        "trace_id": "trace-100",
        "workspace_id": "ws-200",
        "status": "completed",
        "workflow_state": "completed",
        "confidence": 0.95,
        "tokens": 300,
        "latency_ms": 1500.0,
        "fields": [{"field": "amount", "value": "100.00"}],
        "agent_steps": [
            AgentStep(
                agent_name="parsing",
                model_id="default",
                prompt_version="1.0.0",
                input_tokens=100,
                output_tokens=50,
                latency_ms=500.0,
                status="success",
            ),
        ],
        "validation_errors": [],
    }
    defaults.update(overrides)
    return WorkflowResult(**defaults)


class TestHandlerDelegation:
    """Handler delegates to WorkflowOrchestrator with correct event payload."""

    @patch(_ORCH_CLS)
    @patch(_LOAD_WS)
    def test_handler_loads_workspace_and_creates_orchestrator(
        self, mock_load_ws, mock_orch_cls
    ):
        workspace = _sample_workspace()
        mock_load_ws.return_value = workspace

        mock_result = _sample_workflow_result()
        mock_orch_instance = MagicMock()
        mock_orch_instance.run.return_value = mock_result
        mock_orch_cls.return_value = mock_orch_instance

        from services.workflow.handler import handler

        event = _sample_event()
        response = handler(event, None)

        # Verify workspace was loaded with correct workspace_id
        mock_load_ws.assert_called_once_with("ws-200")

        # Verify orchestrator was instantiated
        mock_orch_cls.assert_called_once()
        call_args = mock_orch_cls.call_args
        processing_event = call_args[0][0]
        assert processing_event.trace_id == "trace-100"
        assert processing_event.workspace_id == "ws-200"
        assert processing_event.s3_key == "uploads/invoice.pdf"
        assert processing_event.filename == "invoice.pdf"
        assert call_args[0][1] == workspace

        # Verify run() was called
        mock_orch_instance.run.assert_called_once()

    @patch(_ORCH_CLS)
    @patch(_LOAD_WS)
    def test_handler_passes_all_event_fields(self, mock_load_ws, mock_orch_cls):
        mock_load_ws.return_value = _sample_workspace()

        mock_result = _sample_workflow_result()
        mock_orch_instance = MagicMock()
        mock_orch_instance.run.return_value = mock_result
        mock_orch_cls.return_value = mock_orch_instance

        from services.workflow.handler import handler

        event = _sample_event(
            hitl_threshold=0.6,
            prompt_version="2.0.0",
            schema={"invoice_number": "string"},
        )
        handler(event, None)

        call_args = mock_orch_cls.call_args
        processing_event = call_args[0][0]
        assert processing_event.hitl_threshold == 0.6
        assert processing_event.prompt_version == "2.0.0"
        assert processing_event.schema == {"invoice_number": "string"}


class TestResponseShape:
    """Response shape matches Phase 2 format."""

    @patch(_ORCH_CLS)
    @patch(_LOAD_WS)
    def test_response_contains_phase2_keys(self, mock_load_ws, mock_orch_cls):
        mock_load_ws.return_value = _sample_workspace()

        mock_result = _sample_workflow_result()
        mock_orch_instance = MagicMock()
        mock_orch_instance.run.return_value = mock_result
        mock_orch_cls.return_value = mock_orch_instance

        from services.workflow.handler import handler

        response = handler(_sample_event(), None)

        # Phase 2 required keys
        assert "trace_id" in response
        assert "workspace_id" in response
        assert "status" in response
        assert "confidence" in response
        assert "tokens" in response
        assert "latency_ms" in response
        assert "fields" in response
        assert "workflow_state" in response
        assert "agent_steps" in response
        assert "validation_errors" in response

    @patch(_ORCH_CLS)
    @patch(_LOAD_WS)
    def test_response_values_match_result(self, mock_load_ws, mock_orch_cls):
        mock_load_ws.return_value = _sample_workspace()

        mock_result = _sample_workflow_result(
            trace_id="t-999",
            workspace_id="ws-888",
            status="hitl_required",
            confidence=0.65,
            tokens=500,
            latency_ms=2000.0,
        )
        mock_orch_instance = MagicMock()
        mock_orch_instance.run.return_value = mock_result
        mock_orch_cls.return_value = mock_orch_instance

        from services.workflow.handler import handler

        response = handler(
            _sample_event(trace_id="t-999", workspace_id="ws-888"), None
        )

        assert response["trace_id"] == "t-999"
        assert response["workspace_id"] == "ws-888"
        assert response["status"] == "hitl_required"
        assert response["confidence"] == 0.65
        assert response["tokens"] == 500
        assert response["latency_ms"] == 2000.0

    @patch(_ORCH_CLS)
    @patch(_LOAD_WS)
    def test_response_status_is_valid_phase2_value(
        self, mock_load_ws, mock_orch_cls
    ):
        for status in ("completed", "hitl_required", "failed"):
            mock_load_ws.return_value = _sample_workspace()

            mock_result = _sample_workflow_result(status=status)
            mock_orch_instance = MagicMock()
            mock_orch_instance.run.return_value = mock_result
            mock_orch_cls.return_value = mock_orch_instance

            from services.workflow.handler import handler

            response = handler(_sample_event(), None)
            assert response["status"] in {"completed", "hitl_required", "failed"}


class TestWorkspaceLoading:
    """DynamoDB workspace loading edge cases."""

    @patch(_LOAD_WS)
    def test_workspace_not_found_raises(self, mock_load_ws):
        mock_load_ws.side_effect = ValueError("Workspace not found: ws-missing")

        from services.workflow.handler import handler

        with pytest.raises(ValueError, match="Workspace not found"):
            handler(_sample_event(workspace_id="ws-missing"), None)

    @patch("services.workflow.handler._dynamodb")
    def test_load_workspace_returns_item(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {
            "Item": {"workspace_id": "ws-1", "agents": ["parsing"]}
        }
        mock_dynamodb.Table.return_value = mock_table

        from services.workflow.handler import _load_workspace

        result = _load_workspace("ws-1")
        assert result["workspace_id"] == "ws-1"
        assert result["agents"] == ["parsing"]
        mock_dynamodb.Table.assert_called_with("docops-workspaces")

    @patch("services.workflow.handler._dynamodb")
    def test_load_workspace_raises_when_not_found(self, mock_dynamodb):
        mock_table = MagicMock()
        mock_table.get_item.return_value = {}
        mock_dynamodb.Table.return_value = mock_table

        from services.workflow.handler import _load_workspace

        with pytest.raises(ValueError, match="Workspace not found"):
            _load_workspace("ws-nonexistent")
