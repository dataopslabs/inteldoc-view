"""Property and unit tests for the Processor Lambda handler.

Feature: document-processing-pipeline
"""
from __future__ import annotations

import os
import uuid
from unittest.mock import MagicMock, patch, call
from importlib import import_module as _real_import_module

import boto3
import pytest
from moto import mock_aws
from hypothesis import given, settings
from hypothesis import strategies as st

from services.exceptions import (
    DoclingError,
    DoclingTimeoutError,
    LLMError,
    LLMParsingError,
)

os.environ.setdefault("TRACES_TABLE", "docops-traces")
os.environ.setdefault("DOCUMENTS_BUCKET", "test-bucket")

import services.processor as processor


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

STAGE_S3 = "s3"
STAGE_DOCLING = "docling"
STAGE_LLM = "llm"

pipeline_stage_strategy = st.sampled_from([STAGE_S3, STAGE_DOCLING, STAGE_LLM])

_s3_exception_strategy = st.builds(
    RuntimeError,
    st.text(min_size=1, max_size=100).map(lambda t: f"S3 download failed: {t}"),
)

_docling_error_strategy = st.builds(
    DoclingError,
    status_code=st.integers(min_value=400, max_value=599),
    body=st.text(min_size=1, max_size=200),
)

_docling_timeout_strategy = st.builds(
    DoclingTimeoutError,
    timeout=st.just(60.0),
)

_llm_error_strategy = st.builds(
    LLMError,
    error_type=st.text(min_size=1, max_size=50),
    message=st.text(min_size=1, max_size=200),
)

_llm_parsing_error_strategy = st.builds(
    LLMParsingError,
    raw_output=st.text(min_size=1, max_size=500),
)

exception_by_stage = {
    STAGE_S3: _s3_exception_strategy,
    STAGE_DOCLING: st.one_of(_docling_error_strategy, _docling_timeout_strategy),
    STAGE_LLM: st.one_of(_llm_error_strategy, _llm_parsing_error_strategy),
}

stage_and_exception_strategy = pipeline_stage_strategy.flatmap(
    lambda stage: exception_by_stage[stage].map(lambda exc: (stage, exc))
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_event(trace_id: str) -> dict:
    return {
        "trace_id": trace_id,
        "workspace_id": "ws-001",
        "s3_key": "raw/doc.pdf",
        "filename": "doc.pdf",
        "schema": {},
        "hitl_threshold": 0.8,
        "prompt_version": "1.0.0",
    }


# ---------------------------------------------------------------------------
# Feature: document-processing-pipeline, Property 3: Any processing exception
# results in a failed trace
# ---------------------------------------------------------------------------


@given(data=stage_and_exception_strategy)
@settings(max_examples=200, deadline=None)
def test_property3_any_exception_results_in_failed_trace(data) -> None:
    """For any exception raised during any stage of the processing pipeline
    (S3 download, Docling parsing, LLM extraction), the handler must catch
    the exception and update the trace record with status 'failed' and an
    error message containing relevant failure details.

    Validates: Requirements 1.8, 8.1
    """
    stage, exc = data
    trace_id = str(uuid.uuid4())
    event = _make_event(trace_id)

    # Mock trace update functions — their DynamoDB behaviour is tested
    # separately in test_trace_updates.py.  Here we only verify the handler
    # calls update_trace_failed with the right trace_id and a non-empty
    # error string when any pipeline stage raises.
    with patch.object(processor, "update_trace_processing") as mock_processing, \
         patch.object(processor, "update_trace_failed") as mock_failed, \
         patch.object(processor, "update_trace_success") as mock_success:

        if stage == STAGE_S3:
            # S3 download raises — mock _get_s3_client
            with patch.object(processor, "_get_s3_client") as mock_s3_fn:
                mock_client = MagicMock()
                mock_client.get_object.side_effect = exc
                mock_s3_fn.return_value = mock_client
                result = processor.handler(event)

        elif stage == STAGE_DOCLING:
            # S3 succeeds, Docling raises
            mock_s3_client = MagicMock()
            mock_s3_client.get_object.return_value = {
                "Body": MagicMock(read=MagicMock(return_value=b"fake-pdf"))
            }
            mock_docling = MagicMock()
            mock_docling.DoclingClient.return_value.parse_document.side_effect = exc

            with patch.object(processor, "_get_s3_client", return_value=mock_s3_client), \
                 patch("importlib.import_module", side_effect=lambda name: (
                     mock_docling if "docling" in name else _real_import_module(name)
                 )):
                result = processor.handler(event)

        else:  # STAGE_LLM
            # S3 + Docling succeed, LLM raises
            mock_s3_client = MagicMock()
            mock_s3_client.get_object.return_value = {
                "Body": MagicMock(read=MagicMock(return_value=b"fake-pdf"))
            }
            mock_docling = MagicMock()
            mock_docling.DoclingClient.return_value.parse_document.return_value = "text"
            mock_llm = MagicMock()
            mock_llm.LLMReasoningService.return_value.extract_fields.side_effect = exc

            def _import_switch(name):
                if "docling" in name:
                    return mock_docling
                if "llm" in name:
                    return mock_llm
                return _real_import_module(name)

            with patch.object(processor, "_get_s3_client", return_value=mock_s3_client), \
                 patch("importlib.import_module", side_effect=_import_switch):
                result = processor.handler(event)

        # 1. Handler must return {"status": "failed"}
        assert result == {"status": "failed"}, (
            f"Expected failed for {type(exc).__name__} at '{stage}', got {result}"
        )

        # 2. update_trace_failed must have been called with the trace_id
        #    and a non-empty error string
        mock_failed.assert_called_once()
        call_args = mock_failed.call_args
        assert call_args[0][0] == trace_id, (
            f"update_trace_failed called with wrong trace_id: {call_args[0][0]}"
        )
        error_msg = call_args[0][1]
        assert isinstance(error_msg, str) and len(error_msg) > 0, (
            "update_trace_failed must receive a non-empty error string"
        )

        # 3. update_trace_success must NOT have been called
        mock_success.assert_not_called()

# ---------------------------------------------------------------------------
# Unit tests for Processor Lambda handler (Task 7.3)
# Requirements: 1.1–1.8, 2.3, 5.5, 8.1, 8.2, 8.3, 8.4, 8.5
# ---------------------------------------------------------------------------


@pytest.fixture
def _aws_env(monkeypatch):
    """Set required env vars and reset processor module-level clients."""
    monkeypatch.setenv("TRACES_TABLE", "docops-traces")
    monkeypatch.setenv("DOCUMENTS_BUCKET", "test-bucket")
    monkeypatch.setenv("DOCLING_SERVICE_URL", "http://docling:8080")
    monkeypatch.setenv("BEDROCK_MODEL_ID", "anthropic.claude-v2")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    # Reset lazy-initialised clients so moto mocks take effect
    processor._dynamodb = None
    processor._s3 = None
    yield
    processor._dynamodb = None
    processor._s3 = None


@pytest.fixture
def ddb_table(_aws_env):
    """Create the mocked DynamoDB traces table and return the Table resource."""
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="us-east-1")
        table = ddb.create_table(
            TableName="docops-traces",
            KeySchema=[{"AttributeName": "trace_id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "trace_id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        yield table


@pytest.fixture
def s3_bucket(_aws_env):
    """Create the mocked S3 bucket and upload a test document."""
    with mock_aws():
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket="test-bucket")
        s3.put_object(Bucket="test-bucket", Key="raw/doc.pdf", Body=b"fake-pdf-bytes")
        yield s3


def _reset_processor_clients():
    """Reset lazy-initialised boto3 clients so they bind to the current moto context."""
    processor._dynamodb = None
    processor._s3 = None


def _seed_trace(table, trace_id: str) -> None:
    """Insert a minimal trace record so updates don't operate on a missing item."""
    table.put_item(Item={
        "trace_id": trace_id,
        "workspace_id": "ws-001",
        "tenant_id": "t-001",
        "status": "pending",
    })


def _mock_extraction_result(fields=None, input_tokens=10, output_tokens=5):
    """Build a mock ExtractionResult."""
    from services.models import ExtractionResult, ExtractedField
    if fields is None:
        fields = [
            ExtractedField(field_name="invoice_number", value="INV-001", confidence=0.95),
            ExtractedField(field_name="total_amount", value=100.50, confidence=0.85),
        ]
    return ExtractionResult(fields=fields, input_tokens=input_tokens, output_tokens=output_tokens)


def _make_import_mocks(docling_return="parsed text", llm_result=None):
    """Return (mock_docling_module, mock_llm_module, import_switch) for patching importlib."""
    if llm_result is None:
        llm_result = _mock_extraction_result()

    mock_docling = MagicMock()
    mock_docling.DoclingClient.return_value.parse_document.return_value = docling_return

    mock_llm = MagicMock()
    mock_llm.LLMReasoningService.return_value.extract_fields.return_value = llm_result

    def _import_switch(name):
        if "docling" in name:
            return mock_docling
        if "llm" in name:
            return mock_llm
        return _real_import_module(name)

    return mock_docling, mock_llm, _import_switch


def _setup_aws_resources(with_s3=True):
    """Create mocked DynamoDB table and optionally S3 bucket. Returns the DDB table.

    Also injects the moto-backed boto3 resources directly into the processor
    module so that the handler's lazy-init picks up the mocked backends.
    """
    ddb = boto3.resource("dynamodb", region_name="us-east-1")
    table = ddb.create_table(
        TableName="docops-traces",
        KeySchema=[{"AttributeName": "trace_id", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "trace_id", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    # Inject moto-backed resource so processor._get_table() uses it
    processor._dynamodb = ddb

    if with_s3:
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket="test-bucket")
        s3.put_object(Bucket="test-bucket", Key="raw/doc.pdf", Body=b"fake-pdf-bytes")
        # Inject moto-backed S3 client so processor._get_s3_client() uses it
        processor._s3 = s3
    else:
        processor._s3 = None

    return table


# -- Test: full successful pipeline end-to-end (Req 1.1–1.7) ---------------

class TestHandlerSuccess:
    """End-to-end handler tests with moto for S3 and DynamoDB."""

    def test_successful_pipeline(self, _aws_env):
        """Full pipeline: S3 download → Docling → LLM → trace updated with results."""
        with mock_aws():
            table = _setup_aws_resources()
            trace_id = str(uuid.uuid4())
            _seed_trace(table, trace_id)

            event = {
                "trace_id": trace_id,
                "workspace_id": "ws-001",
                "s3_key": "raw/doc.pdf",
                "filename": "doc.pdf",
                "schema": {
                    "fields": [
                        {"name": "invoice_number", "type": "string", "description": "Invoice #"},
                        {"name": "total_amount", "type": "number", "description": "Total"},
                    ]
                },
                "hitl_threshold": 0.8,
                "prompt_version": "2.0.0",
            }

            extraction = _mock_extraction_result()
            _, _, import_switch = _make_import_mocks(llm_result=extraction)

            with patch("importlib.import_module", side_effect=import_switch):
                result = processor.handler(event)

            # Handler returns completed (mean confidence = (0.95+0.85)/2 = 0.9 >= 0.8)
            assert result == {"status": "completed"}

            # Verify trace record in DynamoDB
            item = table.get_item(Key={"trace_id": trace_id})["Item"]
            assert item["status"] == "completed"
            assert len(item["fields"]) == 2
            assert float(item["confidence"]) == pytest.approx(0.9, abs=1e-6)
            assert item["tokens"] == 15  # 10 + 5
            assert item["prompt_version"] == "2.0.0"
            assert "latency" in item
            assert int(item["latency"]) >= 0

    def test_hitl_required_status(self, _aws_env):
        """When confidence < threshold, trace status should be hitl_required."""
        with mock_aws():
            table = _setup_aws_resources()
            trace_id = str(uuid.uuid4())
            _seed_trace(table, trace_id)

            from services.models import ExtractedField
            low_confidence_fields = [
                ExtractedField(field_name="f1", value="v1", confidence=0.3),
                ExtractedField(field_name="f2", value="v2", confidence=0.4),
            ]
            extraction = _mock_extraction_result(fields=low_confidence_fields)
            _, _, import_switch = _make_import_mocks(llm_result=extraction)

            event = _make_event(trace_id)
            event["hitl_threshold"] = 0.8

            with patch("importlib.import_module", side_effect=import_switch):
                result = processor.handler(event)

            assert result == {"status": "hitl_required"}
            item = table.get_item(Key={"trace_id": trace_id})["Item"]
            assert item["status"] == "hitl_required"
            assert len(item["fields"]) == 2


# -- Test: empty schema → confidence 1.0, status "completed" (Req 5.5) -----

class TestEmptySchema:

    def test_empty_schema_returns_completed(self, _aws_env):
        """Empty schema produces no fields, confidence defaults to 1.0, status completed."""
        with mock_aws():
            table = _setup_aws_resources()
            trace_id = str(uuid.uuid4())
            _seed_trace(table, trace_id)

            # LLM returns zero fields for empty schema
            extraction = _mock_extraction_result(fields=[], input_tokens=5, output_tokens=3)
            _, _, import_switch = _make_import_mocks(llm_result=extraction)

            event = _make_event(trace_id)
            event["schema"] = {}

            with patch("importlib.import_module", side_effect=import_switch):
                result = processor.handler(event)

            assert result == {"status": "completed"}
            item = table.get_item(Key={"trace_id": trace_id})["Item"]
            assert item["status"] == "completed"
            assert float(item["confidence"]) == pytest.approx(1.0)
            assert item["fields"] == []


# -- Test: S3 download failure → trace "failed" (Req 2.3) ------------------

class TestS3Failure:

    def test_s3_download_failure(self, _aws_env):
        """S3 GetObject failure updates trace to failed with error message."""
        with mock_aws():
            table = _setup_aws_resources(with_s3=False)
            trace_id = str(uuid.uuid4())
            _seed_trace(table, trace_id)

            event = _make_event(trace_id)
            # Don't create the S3 bucket — download will fail
            # We need to mock _get_s3_client to raise
            mock_s3_client = MagicMock()
            mock_s3_client.get_object.side_effect = Exception("NoSuchKey: raw/doc.pdf")

            with patch.object(processor, "_get_s3_client", return_value=mock_s3_client):
                result = processor.handler(event)

            assert result == {"status": "failed"}
            item = table.get_item(Key={"trace_id": trace_id})["Item"]
            assert item["status"] == "failed"
            assert "S3 download failed" in item["error"]


# -- Test: Docling timeout → trace "failed" (Req 8.4) ----------------------

class TestDoclingTimeout:

    def test_docling_timeout_fails_trace(self, _aws_env):
        """Docling timeout exception updates trace to failed with timeout message."""
        with mock_aws():
            table = _setup_aws_resources()
            trace_id = str(uuid.uuid4())
            _seed_trace(table, trace_id)

            mock_docling = MagicMock()
            mock_docling.DoclingClient.return_value.parse_document.side_effect = DoclingTimeoutError(60.0)

            def _import_switch(name):
                if "docling" in name:
                    return mock_docling
                return _real_import_module(name)

            event = _make_event(trace_id)

            with patch("importlib.import_module", side_effect=_import_switch):
                result = processor.handler(event)

            assert result == {"status": "failed"}
            item = table.get_item(Key={"trace_id": trace_id})["Item"]
            assert item["status"] == "failed"
            assert "timed out" in item["error"]


# -- Test: LLM parsing failure → trace "failed" (Req 8.5) ------------------

class TestLLMParsingFailure:

    def test_llm_parsing_failure_fails_trace(self, _aws_env):
        """LLM parsing exception updates trace to failed with parsing message."""
        with mock_aws():
            table = _setup_aws_resources()
            trace_id = str(uuid.uuid4())
            _seed_trace(table, trace_id)

            mock_docling = MagicMock()
            mock_docling.DoclingClient.return_value.parse_document.return_value = "parsed text"
            mock_llm = MagicMock()
            mock_llm.LLMReasoningService.return_value.extract_fields.side_effect = LLMParsingError("not json {{{")

            def _import_switch(name):
                if "docling" in name:
                    return mock_docling
                if "llm" in name:
                    return mock_llm
                return _real_import_module(name)

            event = _make_event(trace_id)

            with patch("importlib.import_module", side_effect=_import_switch):
                result = processor.handler(event)

            assert result == {"status": "failed"}
            item = table.get_item(Key={"trace_id": trace_id})["Item"]
            assert item["status"] == "failed"
            assert "parse LLM response" in item["error"]


# -- Test: double-fault (Req 8.2) ------------------------------------------

class TestDoubleFault:

    def test_double_fault_logs_both_errors(self, _aws_env):
        """When trace update fails during error handling, both errors are logged."""
        trace_id = str(uuid.uuid4())
        event = _make_event(trace_id)

        mock_s3_client = MagicMock()
        mock_s3_client.get_object.side_effect = RuntimeError("S3 boom")

        with patch.object(processor, "_get_s3_client", return_value=mock_s3_client), \
             patch.object(processor, "update_trace_processing"), \
             patch.object(processor, "update_trace_failed", side_effect=Exception("DDB boom")), \
             patch.object(processor.logger, "error") as mock_log_error:
            result = processor.handler(event)

        assert result == {"status": "failed"}

        # Both the original error and the update failure should be logged
        log_messages = [str(c) for c in mock_log_error.call_args_list]
        joined = " ".join(log_messages)
        assert "S3" in joined or "boom" in joined, "Original error should be logged"
        assert "DDB" in joined or "update trace" in joined.lower() or "Failed to update" in joined, \
            "Trace update failure should be logged"


# -- Test: event validation failure (Req 8.1) ------------------------------

class TestEventValidation:

    def test_missing_trace_id_fails(self, _aws_env):
        """Missing required field in event payload updates trace to failed."""
        with mock_aws():
            _setup_aws_resources(with_s3=False)

            # Event missing required fields
            event = {"hitl_threshold": 0.5}
            result = processor.handler(event)
            assert result == {"status": "failed"}

    def test_invalid_event_with_trace_id_updates_trace(self, _aws_env):
        """When event has trace_id but other fields are invalid, trace is set to failed."""
        with mock_aws():
            table = _setup_aws_resources(with_s3=False)
            trace_id = str(uuid.uuid4())
            _seed_trace(table, trace_id)

            # trace_id present but missing workspace_id, s3_key, filename
            event = {"trace_id": trace_id}
            result = processor.handler(event)

            assert result == {"status": "failed"}
            item = table.get_item(Key={"trace_id": trace_id})["Item"]
            assert item["status"] == "failed"
            assert "Invalid event payload" in item["error"]
