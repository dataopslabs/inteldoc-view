"""G5-03: Unit tests for processor models."""
from __future__ import annotations

import pytest
from models import TraceStatus, ErrorCode, ProcessingResult, FieldResult, ReconciliationResult


class TestTraceStatus:
    def test_all_statuses_present(self):
        assert TraceStatus.pending == "pending"
        assert TraceStatus.processing == "processing"
        assert TraceStatus.completed == "completed"
        assert TraceStatus.failed == "failed"
        assert TraceStatus.hitl_required == "hitl_required"


class TestErrorCode:
    def test_s3_codes(self):
        assert ErrorCode.S3_NOT_FOUND == "S3_NOT_FOUND"
        assert ErrorCode.S3_ACCESS_DENIED == "S3_ACCESS_DENIED"
        assert ErrorCode.S3_DOWNLOAD_FAILED == "S3_DOWNLOAD_FAILED"

    def test_docling_codes(self):
        assert ErrorCode.DOCLING_TIMEOUT == "DOCLING_TIMEOUT"
        assert ErrorCode.DOCLING_SERVICE_ERROR == "DOCLING_SERVICE_ERROR"
        assert ErrorCode.DOCLING_CONVERSION_FAILED == "DOCLING_CONVERSION_FAILED"

    def test_bedrock_codes(self):
        assert ErrorCode.BEDROCK_THROTTLE == "BEDROCK_THROTTLE"
        assert ErrorCode.BEDROCK_MODEL_ERROR == "BEDROCK_MODEL_ERROR"
        assert ErrorCode.LLM_PARSE_FAILED == "LLM_PARSE_FAILED"

    def test_infra_codes(self):
        assert ErrorCode.DYNAMODB_WRITE_FAILED == "DYNAMODB_WRITE_FAILED"
        assert ErrorCode.UNKNOWN_ERROR == "UNKNOWN_ERROR"


class TestProcessingResult:
    def test_defaults(self):
        result = ProcessingResult(
            trace_id="trace-123",
            workspace_id="ws-456",
            status=TraceStatus.processing,
        )
        assert result.trace_id == "trace-123"
        assert result.workspace_id == "ws-456"
        assert result.tenant_id == ""  # G5-19: default empty string
        assert result.status == TraceStatus.processing
        assert result.fields == []
        assert result.overall_confidence == 0.0
        assert result.tokens_input == 0
        assert result.tokens_output == 0
        assert result.error is None
        assert result.error_code is None  # G5-08: default None

    def test_with_tenant_id(self):
        """G5-19: tenant_id must be stored in ProcessingResult."""
        result = ProcessingResult(
            trace_id="trace-123",
            workspace_id="ws-456",
            tenant_id="tenant-789",
            status=TraceStatus.completed,
        )
        assert result.tenant_id == "tenant-789"

    def test_failed_with_error_code(self):
        """G5-08: error_code must be stored in failed results."""
        result = ProcessingResult(
            trace_id="trace-123",
            workspace_id="ws-456",
            status=TraceStatus.failed,
            error="Docling timed out",
            error_code=ErrorCode.DOCLING_TIMEOUT,
        )
        assert result.error == "Docling timed out"
        assert result.error_code == ErrorCode.DOCLING_TIMEOUT

    def test_model_dump_includes_error_code(self):
        result = ProcessingResult(
            trace_id="trace-123",
            workspace_id="ws-456",
            status=TraceStatus.failed,
            error_code=ErrorCode.UNKNOWN_ERROR,
        )
        dumped = result.model_dump()
        assert "error_code" in dumped
        assert dumped["error_code"] == "UNKNOWN_ERROR"


class TestFieldResult:
    def test_defaults(self):
        field = FieldResult(field="invoice_number")
        assert field.field == "invoice_number"
        assert field.docling_value is None
        assert field.llm_value is None
        assert field.final_value is None
        assert field.confidence == 1.0
        assert field.conflict is False

    def test_conflict_detection(self):
        field = FieldResult(
            field="amount",
            docling_value="100",
            llm_value="200",
            final_value="200",
            confidence=0.5,
            conflict=True,
        )
        assert field.conflict is True
        assert field.confidence == 0.5


class TestReconciliationResult:
    def test_no_fields(self):
        recon = ReconciliationResult(
            fields=[],
            overall_confidence=1.0,
            hitl_required=False,
        )
        assert recon.hitl_required is False
        assert recon.overall_confidence == 1.0

    def test_hitl_flagged_below_threshold(self):
        """Reconciliation result with low confidence should flag HITL."""
        fields = [
            FieldResult(field="amount", confidence=0.3, conflict=True),
        ]
        recon = ReconciliationResult(
            fields=fields,
            overall_confidence=0.3,
            hitl_required=True,
        )
        assert recon.hitl_required is True
