"""Tests for DynamoDB trace update operations.

Covers tasks 6.2, 6.3, 6.4 from the document-processing-pipeline spec.
"""
from __future__ import annotations

import os
import uuid
from decimal import Decimal

import boto3
import pytest
from moto import mock_aws
from hypothesis import given, settings, strategies as st

# Ensure env var is set before importing processor module
os.environ.setdefault("TRACES_TABLE", "docops-traces")

import services.processor as processor


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _reset_dynamodb_resource():
    """Reset the module-level DynamoDB resource between tests."""
    processor._dynamodb = None
    yield
    processor._dynamodb = None


@pytest.fixture()
def traces_table():
    """Create a mocked DynamoDB traces table and patch the env var."""
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="us-east-1")
        table = ddb.create_table(
            TableName="docops-traces",
            KeySchema=[{"AttributeName": "trace_id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "trace_id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        table.meta.client.get_waiter("table_exists").wait(TableName="docops-traces")
        os.environ["TRACES_TABLE"] = "docops-traces"
        os.environ["AWS_DEFAULT_REGION"] = "us-east-1"
        os.environ["AWS_ACCESS_KEY_ID"] = "testing"
        os.environ["AWS_SECRET_ACCESS_KEY"] = "testing"
        # Force processor to pick up the mocked resource
        processor._dynamodb = ddb
        yield table


def _seed_trace(table, trace_id: str, **extra) -> dict:
    """Insert a minimal trace record and return it."""
    item = {
        "trace_id": trace_id,
        "workspace_id": "ws-001",
        "tenant_id": "tenant-001",
        "s3_key": "raw/doc.pdf",
        "filename": "doc.pdf",
        "created_at": "2025-01-01T00:00:00Z",
        "status": "pending",
        **extra,
    }
    table.put_item(Item=item)
    return item


# ---------------------------------------------------------------------------
# 6.4 — Unit tests for trace update operations
# ---------------------------------------------------------------------------


class TestUpdateTraceProcessing:
    """update_trace_processing sets status to 'processing'."""

    def test_sets_status_to_processing(self, traces_table):
        tid = str(uuid.uuid4())
        _seed_trace(traces_table, tid)

        processor.update_trace_processing(tid)

        item = traces_table.get_item(Key={"trace_id": tid})["Item"]
        assert item["status"] == "processing"

    def test_preserves_existing_attributes(self, traces_table):
        tid = str(uuid.uuid4())
        _seed_trace(traces_table, tid)

        processor.update_trace_processing(tid)

        item = traces_table.get_item(Key={"trace_id": tid})["Item"]
        assert item["workspace_id"] == "ws-001"
        assert item["tenant_id"] == "tenant-001"
        assert item["filename"] == "doc.pdf"


class TestUpdateTraceSuccess:
    """update_trace_success writes all result fields correctly."""

    def test_writes_all_fields(self, traces_table):
        tid = str(uuid.uuid4())
        _seed_trace(traces_table, tid)

        fields = [
            {"field_name": "invoice_number", "value": "INV-001", "confidence": 0.95},
            {"field_name": "total", "value": 100.50, "confidence": 0.88},
        ]
        processor.update_trace_success(
            trace_id=tid,
            fields=fields,
            confidence=0.915,
            tokens=1500,
            latency=3200,
            prompt_version="1.0.0",
            status="completed",
        )

        item = traces_table.get_item(Key={"trace_id": tid})["Item"]
        assert item["status"] == "completed"
        assert len(item["fields"]) == 2
        assert item["fields"][0]["field_name"] == "invoice_number"
        assert float(item["confidence"]) == pytest.approx(0.915)
        assert item["tokens"] == 1500
        assert item["latency"] == 3200
        assert item["prompt_version"] == "1.0.0"

    def test_hitl_required_status(self, traces_table):
        tid = str(uuid.uuid4())
        _seed_trace(traces_table, tid)

        processor.update_trace_success(
            trace_id=tid,
            fields=[{"field_name": "x", "value": "y", "confidence": 0.5}],
            confidence=0.5,
            tokens=100,
            latency=500,
            prompt_version="1.0.0",
            status="hitl_required",
        )

        item = traces_table.get_item(Key={"trace_id": tid})["Item"]
        assert item["status"] == "hitl_required"


class TestUpdateTraceFailed:
    """update_trace_failed writes status and error."""

    def test_sets_status_to_failed(self, traces_table):
        tid = str(uuid.uuid4())
        _seed_trace(traces_table, tid)

        processor.update_trace_failed(tid, "S3 download failed: NoSuchKey")

        item = traces_table.get_item(Key={"trace_id": tid})["Item"]
        assert item["status"] == "failed"
        assert item["error"] == "S3 download failed: NoSuchKey"

    def test_preserves_existing_attributes(self, traces_table):
        tid = str(uuid.uuid4())
        _seed_trace(traces_table, tid)

        processor.update_trace_failed(tid, "boom")

        item = traces_table.get_item(Key={"trace_id": tid})["Item"]
        assert item["workspace_id"] == "ws-001"
        assert item["tenant_id"] == "tenant-001"
        assert item["created_at"] == "2025-01-01T00:00:00Z"


# ---------------------------------------------------------------------------
# 6.2 — Property 9: Successful trace update contains all required attributes
# ---------------------------------------------------------------------------

# Feature: document-processing-pipeline, Property 9: Successful trace update contains all required attributes

_confidence_st = st.integers(min_value=0, max_value=100).map(lambda x: x / 100.0)

_field_st = st.fixed_dictionaries({
    "field_name": st.text(min_size=1, max_size=30),
    "value": st.one_of(st.text(max_size=50), st.integers(min_value=-1_000_000, max_value=1_000_000)),
    "confidence": _confidence_st,
})


@given(
    fields=st.lists(_field_st, min_size=1, max_size=10),
    confidence=_confidence_st,
    tokens=st.integers(min_value=0, max_value=100_000),
    latency=st.integers(min_value=1, max_value=300_000),
    prompt_version=st.from_regex(r"[0-9]+\.[0-9]+\.[0-9]+", fullmatch=True),
    status=st.sampled_from(["completed", "hitl_required"]),
)
@settings(max_examples=100, deadline=None)
def test_property9_successful_trace_contains_all_required_attributes(
    fields, confidence, tokens, latency, prompt_version, status
):
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="us-east-1")
        table = ddb.create_table(
            TableName="docops-traces",
            KeySchema=[{"AttributeName": "trace_id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "trace_id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        table.meta.client.get_waiter("table_exists").wait(TableName="docops-traces")

        tid = str(uuid.uuid4())
        table.put_item(Item={"trace_id": tid, "status": "processing"})

        processor._dynamodb = ddb
        try:
            processor.update_trace_success(
                trace_id=tid,
                fields=fields,
                confidence=confidence,
                tokens=tokens,
                latency=latency,
                prompt_version=prompt_version,
                status=status,
            )

            item = table.get_item(Key={"trace_id": tid})["Item"]

            # All required attributes must be present
            assert item["status"] == status
            assert "fields" in item
            assert len(item["fields"]) == len(fields)
            assert float(item["confidence"]) == pytest.approx(confidence, abs=1e-6)
            assert item["tokens"] == tokens
            assert item["latency"] == latency
            assert item["prompt_version"] == prompt_version
        finally:
            processor._dynamodb = None


# ---------------------------------------------------------------------------
# 6.3 — Property 10: Trace updates preserve existing attributes
# ---------------------------------------------------------------------------

# Feature: document-processing-pipeline, Property 10: Trace updates preserve existing attributes

_existing_attrs_st = st.fixed_dictionaries({
    "workspace_id": st.text(min_size=1, max_size=20),
    "tenant_id": st.text(min_size=1, max_size=20),
    "s3_key": st.text(min_size=1, max_size=50),
    "filename": st.text(min_size=1, max_size=50),
    "created_at": st.text(min_size=1, max_size=30),
})


@given(existing=_existing_attrs_st)
@settings(max_examples=100, deadline=None)
def test_property10_trace_updates_preserve_existing_attributes(existing):
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="us-east-1")
        table = ddb.create_table(
            TableName="docops-traces",
            KeySchema=[{"AttributeName": "trace_id", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "trace_id", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        table.meta.client.get_waiter("table_exists").wait(TableName="docops-traces")

        tid = str(uuid.uuid4())
        seed = {"trace_id": tid, "status": "pending", **existing}
        table.put_item(Item=seed)

        processor._dynamodb = ddb
        try:
            # Apply each update type and verify existing attrs survive
            processor.update_trace_processing(tid)
            item = table.get_item(Key={"trace_id": tid})["Item"]
            for key, val in existing.items():
                assert item[key] == val, f"update_trace_processing lost {key}"

            processor.update_trace_success(
                trace_id=tid,
                fields=[{"field_name": "f", "value": "v", "confidence": 0.9}],
                confidence=0.9,
                tokens=100,
                latency=500,
                prompt_version="1.0.0",
                status="completed",
            )
            item = table.get_item(Key={"trace_id": tid})["Item"]
            for key, val in existing.items():
                assert item[key] == val, f"update_trace_success lost {key}"

            processor.update_trace_failed(tid, "test error")
            item = table.get_item(Key={"trace_id": tid})["Item"]
            for key, val in existing.items():
                assert item[key] == val, f"update_trace_failed lost {key}"
        finally:
            processor._dynamodb = None
