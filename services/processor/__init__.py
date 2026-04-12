# DocOps Processing Lambda — Phase 2

from __future__ import annotations

import importlib
import logging
import os
import time
from decimal import Decimal
from typing import Any

import boto3
from pydantic import ValidationError

from services.models import ExtractedField, ProcessingEvent

logger = logging.getLogger(__name__)

_dynamodb = None
_s3 = None


def _get_s3_client():
    """Return a boto3 S3 client (lazy-initialised)."""
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


def _get_table():
    """Return a boto3 DynamoDB Table resource for the traces table (lazy-initialised)."""
    global _dynamodb
    if _dynamodb is None:
        _dynamodb = boto3.resource("dynamodb")
    table_name = os.environ.get("TRACES_TABLE", "docops-traces")
    return _dynamodb.Table(table_name)


def compute_confidence(fields: list[ExtractedField]) -> float:
    """Return the arithmetic mean of per-field confidence scores, or 1.0 if the list is empty."""
    if not fields:
        return 1.0
    return sum(f.confidence for f in fields) / len(fields)


def determine_status(confidence: float, threshold: float) -> str:
    """Return 'completed' if confidence >= threshold, otherwise 'hitl_required'."""
    return "completed" if confidence >= threshold else "hitl_required"


# ---------------------------------------------------------------------------
# DynamoDB trace update helpers
# ---------------------------------------------------------------------------

def update_trace_processing(trace_id: str) -> None:
    """Set trace status to 'processing'."""
    table = _get_table()
    table.update_item(
        Key={"trace_id": trace_id},
        UpdateExpression="SET #s = :status",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":status": "processing"},
    )


def update_trace_success(
    trace_id: str,
    fields: list[dict[str, Any]],
    confidence: float,
    tokens: int,
    latency: int,
    prompt_version: str,
    status: str = "completed",
) -> None:
    """Update trace with successful processing results.

    ``status`` should be ``"completed"`` or ``"hitl_required"`` as determined
    by the caller via :func:`determine_status`.
    """
    # Convert float values inside field dicts to Decimal for DynamoDB
    ddb_fields = []
    for f in fields:
        ddb_f = {}
        for k, v in f.items():
            ddb_f[k] = Decimal(str(v)) if isinstance(v, float) else v
        ddb_fields.append(ddb_f)

    table = _get_table()
    table.update_item(
        Key={"trace_id": trace_id},
        UpdateExpression=(
            "SET #s = :status, #f = :fields, #c = :confidence, "
            "#t = :tokens, #l = :latency, #pv = :prompt_version"
        ),
        ExpressionAttributeNames={
            "#s": "status",
            "#f": "fields",
            "#c": "confidence",
            "#t": "tokens",
            "#l": "latency",
            "#pv": "prompt_version",
        },
        ExpressionAttributeValues={
            ":status": status,
            ":fields": ddb_fields,
            ":confidence": Decimal(str(confidence)),
            ":tokens": tokens,
            ":latency": latency,
            ":prompt_version": prompt_version,
        },
    )


def update_trace_failed(trace_id: str, error: str) -> None:
    """Set trace status to 'failed' with an error message."""
    table = _get_table()
    table.update_item(
        Key={"trace_id": trace_id},
        UpdateExpression="SET #s = :status, #e = :error",
        ExpressionAttributeNames={"#s": "status", "#e": "error"},
        ExpressionAttributeValues={":status": "failed", ":error": error},
    )


# ---------------------------------------------------------------------------
# Lambda handler
# ---------------------------------------------------------------------------

def handler(event: dict, context: Any = None) -> dict:
    """Lambda entry point — orchestrates the document processing pipeline.

    Steps:
        1. Parse & validate event
        2. Mark trace as "processing"
        3. Download document from S3
        4. Parse document via Docling
        5. Extract fields via Bedrock LLM
        6. Compute confidence & determine status
        7. Update trace with results

    Any exception at any stage updates the trace to "failed".
    """
    trace_id = event.get("trace_id")
    start_time = time.time()

    try:
        # 1. Validate event
        try:
            pe = ProcessingEvent.model_validate(event)
        except ValidationError as ve:
            raise ValueError(f"Invalid event payload: {ve}") from ve

        trace_id = pe.trace_id

        # 2. Mark trace as processing
        update_trace_processing(trace_id)

        # 3. Download document from S3
        bucket = os.environ.get("DOCUMENTS_BUCKET", "")
        try:
            s3_resp = _get_s3_client().get_object(Bucket=bucket, Key=pe.s3_key)
            file_bytes = s3_resp["Body"].read()
        except Exception as s3_err:
            raise RuntimeError(f"S3 download failed: {s3_err}") from s3_err

        # 4. Parse document via Docling
        # importlib.import_module is patched in tests; "docling" in name triggers mock
        docling_mod = importlib.import_module("services.docling_client")
        docling_client = docling_mod.DoclingClient()
        parsed_text = docling_client.parse_document(file_bytes, pe.filename)

        # 5. Extract fields via LLM
        # importlib.import_module is patched in tests; "llm" in name triggers mock
        llm_mod = importlib.import_module("services.llm_reasoning")
        llm_service = llm_mod.LLMReasoningService()
        result = llm_service.extract_fields(parsed_text, pe.schema_)

        # 6. Compute confidence & determine status
        confidence = compute_confidence(result.fields)
        status = determine_status(confidence, pe.hitl_threshold)

        # 7. Update trace with results
        latency = int((time.time() - start_time) * 1000)
        fields_dicts = [f.model_dump() for f in result.fields]
        update_trace_success(
            trace_id=trace_id,
            fields=fields_dicts,
            confidence=confidence,
            tokens=result.input_tokens + result.output_tokens,
            latency=latency,
            prompt_version=pe.prompt_version,
            status=status,
        )

        return {"status": status}

    except Exception as exc:
        logger.error("Processing failed: %s", exc, exc_info=True)
        try:
            if trace_id:
                update_trace_failed(trace_id, str(exc))
        except Exception as update_err:
            logger.error("Original error: %s", exc)
            logger.error("Failed to update trace: %s", update_err)
        return {"status": "failed"}
