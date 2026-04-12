"""G5-03 + G5-08: Unit tests for _classify_error in handler.py."""
from __future__ import annotations

import sys
import os

# Add processor directory to path for direct import
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import MagicMock
from botocore.exceptions import ClientError
from models import ErrorCode
from docling_client import DoclingError

# We need to set env vars before importing handler
os.environ.setdefault("TRACES_TABLE", "test-traces")
os.environ.setdefault("WORKSPACES_TABLE", "test-workspaces")
os.environ.setdefault("DOCUMENTS_BUCKET", "test-bucket")
os.environ.setdefault("DOCLING_SERVICE_URL", "http://localhost:5001")

from handler import _classify_error


class TestClassifyError:
    def test_docling_timeout(self):
        exc = DoclingError("Docling request timed out after 120s")
        assert _classify_error(exc) == ErrorCode.DOCLING_TIMEOUT

    def test_docling_service_error(self):
        exc = DoclingError("Docling returned HTTP 503 (transient)")
        assert _classify_error(exc) == ErrorCode.DOCLING_SERVICE_ERROR

    def test_docling_not_found(self):
        exc = DoclingError("S3 object not found: raw/tenant/ws/file.pdf [NoSuchKey]")
        assert _classify_error(exc) == ErrorCode.S3_NOT_FOUND

    def test_docling_access_denied(self):
        exc = DoclingError("S3 object access denied: raw/tenant/ws/file.pdf [AccessDenied]")
        assert _classify_error(exc) == ErrorCode.S3_NOT_FOUND

    def test_docling_conversion_failed(self):
        exc = DoclingError("Docling conversion status='failure': []")
        assert _classify_error(exc) == ErrorCode.DOCLING_CONVERSION_FAILED

    def test_llm_throttle(self):
        from llm_reasoning import LLMError
        exc = LLMError("Request was throttled by Bedrock")
        assert _classify_error(exc) == ErrorCode.BEDROCK_THROTTLE

    def test_llm_too_many_requests(self):
        from llm_reasoning import LLMError
        exc = LLMError("too many requests")
        assert _classify_error(exc) == ErrorCode.BEDROCK_THROTTLE

    def test_llm_parse_failed(self):
        from llm_reasoning import LLMError
        exc = LLMError("JSON parse error in model response")
        assert _classify_error(exc) == ErrorCode.LLM_PARSE_FAILED

    def test_llm_model_error(self):
        from llm_reasoning import LLMError
        exc = LLMError("Model returned an unexpected response format")
        assert _classify_error(exc) == ErrorCode.BEDROCK_MODEL_ERROR

    def test_s3_no_such_key(self):
        exc = _make_client_error("NoSuchKey")
        assert _classify_error(exc) == ErrorCode.S3_NOT_FOUND

    def test_s3_access_denied(self):
        exc = _make_client_error("AccessDenied")
        assert _classify_error(exc) == ErrorCode.S3_ACCESS_DENIED

    def test_dynamodb_throttle(self):
        exc = _make_client_error("ProvisionedThroughputExceededException")
        assert _classify_error(exc) == ErrorCode.DYNAMODB_WRITE_FAILED

    def test_dynamodb_throttling_exception(self):
        exc = _make_client_error("ThrottlingException")
        assert _classify_error(exc) == ErrorCode.DYNAMODB_WRITE_FAILED

    def test_s3_other_error(self):
        exc = _make_client_error("InternalError")
        assert _classify_error(exc) == ErrorCode.S3_DOWNLOAD_FAILED

    def test_unknown_exception(self):
        exc = ValueError("Something unexpected happened")
        assert _classify_error(exc) == ErrorCode.UNKNOWN_ERROR

    def test_generic_exception(self):
        exc = RuntimeError("Out of memory")
        assert _classify_error(exc) == ErrorCode.UNKNOWN_ERROR


def _make_client_error(code: str) -> ClientError:
    """Helper to create a boto3 ClientError with a given error code."""
    return ClientError(
        error_response={"Error": {"Code": code, "Message": f"Test error: {code}"}},
        operation_name="TestOperation",
    )
