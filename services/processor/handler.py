"""
DocOps Processing Lambda — Phase 2 Document Processing Pipeline.

Invoked asynchronously by the API Lambda with:
{
  "trace_id": str,
  "workspace_id": str,
  "tenant_id": str,        # G5-19: propagated for security isolation
  "s3_key": str,
  "filename": str,
  "schema": dict,
  "hitl_threshold": float,
  "prompt_version": str
}
"""
from __future__ import annotations

import json
import logging
import os
import time
import random
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import ClientError

from docling_client import parse_document, DoclingError
from llm_reasoning import extract_fields, LLMError
from reconciliation import reconcile
from models import TraceStatus, ProcessingResult, ErrorCode

# Structured JSON logging — every log entry is parseable by CloudWatch Logs Insights
class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "message": record.getMessage(),
        }
        if hasattr(record, "extra"):
            payload.update(record.extra)  # type: ignore[arg-type]
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload)

_handler = logging.StreamHandler()
_handler.setFormatter(_JsonFormatter())
logger = logging.getLogger(__name__)
logger.handlers = [_handler]
logger.setLevel(logging.INFO)
logger.propagate = False


TRACES_TABLE = os.environ["TRACES_TABLE"]
WORKSPACES_TABLE = os.environ["WORKSPACES_TABLE"]
DOCUMENTS_BUCKET = os.environ["DOCUMENTS_BUCKET"]
# G5-12: EventBridge custom bus ARN/name for trace lifecycle events.
# The env var is set by ProcessingStack; defaults to the custom bus name.
TRACE_EVENT_BUS = os.environ.get("TRACE_EVENT_BUS_NAME", "docops-trace-events")

_dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION_NAME", "us-east-1"))
_s3 = boto3.client("s3")
_events = boto3.client("events", region_name=os.environ.get("AWS_REGION_NAME", "us-east-1"))
_traces = _dynamodb.Table(TRACES_TABLE)

# Retry config
_MAX_RETRIES = 3
_BASE_BACKOFF_MS = 100


def _sleep_backoff(attempt: int) -> None:
    """Exponential backoff with jitter."""
    delay = (_BASE_BACKOFF_MS * (2 ** attempt) + random.randint(0, 100)) / 1000.0
    time.sleep(delay)


def _classify_error(exc: Exception) -> str:
    """
    G5-08: Map exception types to structured error codes.
    Returns an ErrorCode string for storage and alerting.
    """
    exc_msg = str(exc).lower()

    if isinstance(exc, DoclingError):
        if "timed out" in exc_msg or "timeout" in exc_msg:
            return ErrorCode.DOCLING_TIMEOUT
        if "http 5" in exc_msg or "transient" in exc_msg:
            return ErrorCode.DOCLING_SERVICE_ERROR
        if "not found" in exc_msg or "access denied" in exc_msg:
            return ErrorCode.S3_NOT_FOUND
        return ErrorCode.DOCLING_CONVERSION_FAILED

    if isinstance(exc, LLMError):
        if "throttl" in exc_msg or "too many request" in exc_msg:
            return ErrorCode.BEDROCK_THROTTLE
        if "parse" in exc_msg or "json" in exc_msg:
            return ErrorCode.LLM_PARSE_FAILED
        return ErrorCode.BEDROCK_MODEL_ERROR

    if isinstance(exc, ClientError):
        code = ""
        if hasattr(exc, "response"):
            code = exc.response.get("Error", {}).get("Code", "")
        if code == "NoSuchKey":
            return ErrorCode.S3_NOT_FOUND
        if code == "AccessDenied":
            return ErrorCode.S3_ACCESS_DENIED
        if code in ("ProvisionedThroughputExceededException", "ThrottlingException"):
            return ErrorCode.DYNAMODB_WRITE_FAILED
        return ErrorCode.S3_DOWNLOAD_FAILED

    return ErrorCode.UNKNOWN_ERROR


def _publish_trace_event(
    trace_id: str,
    tenant_id: str,
    workspace_id: str,
    status: str,
    error_code: str | None,
    ctx: dict[str, Any],
) -> None:
    """
    G5-12: Publish a TraceStatusChanged event to the custom EventBridge bus.
    This triggers the WebhookDispatcher Lambda which fans out to registered tenant webhooks.
    Best-effort: failures are logged but never block the main processing result.
    """
    detail = {
        "trace_id": trace_id,
        "tenant_id": tenant_id,
        "workspace_id": workspace_id,
        "status": status,
        "error_code": error_code,
    }
    try:
        _events.put_events(Entries=[{
            "Source": "docops.processor",
            "DetailType": "TraceStatusChanged",
            "Detail": json.dumps(detail),
            "EventBusName": TRACE_EVENT_BUS,
        }])
        _log(logging.INFO, "Trace event published", {**ctx, "status": status, "event_bus": TRACE_EVENT_BUS})
    except Exception as exc:  # noqa: BLE001
        # EventBridge publish failure must never block trace completion
        _log(logging.WARNING, "Failed to publish trace event to EventBridge", {
            **ctx,
            "status": status,
            "error": str(exc),
        })


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    trace_id: str = event["trace_id"]
    workspace_id: str = event["workspace_id"]
    tenant_id: str = event.get("tenant_id", "")   # G5-19: propagated from API Lambda
    s3_key: str = event["s3_key"]
    filename: str = event.get("filename", "document")
    schema: dict[str, Any] = event.get("schema") or {}
    prompt_version: str = event.get("prompt_version", "1.0.0")

    # Validate + clamp hitl_threshold
    raw_threshold = event.get("hitl_threshold", 0.8)
    try:
        hitl_threshold = float(raw_threshold)
    except (TypeError, ValueError):
        hitl_threshold = 0.8
    hitl_threshold = max(0.0, min(1.0, hitl_threshold))

    ctx = {"trace_id": trace_id, "workspace_id": workspace_id, "tenant_id": tenant_id}
    _log(logging.INFO, "Processing started", ctx)

    start_ms = int(time.time() * 1000)
    agent_steps: list[str] = []
    result = ProcessingResult(
        trace_id=trace_id,
        workspace_id=workspace_id,
        tenant_id=tenant_id,
        status=TraceStatus.processing,
        prompt_version=prompt_version,
    )

    _update_trace(trace_id, {"status": TraceStatus.processing}, ctx)

    try:
        # Step 1: Download document from S3
        step_start = int(time.time() * 1000)
        _log(logging.INFO, "Step: s3_download", {**ctx, "s3_key": s3_key})
        file_bytes = _download_s3(s3_key)
        agent_steps.append("s3_download")
        _log(logging.INFO, "Step complete: s3_download", {**ctx, "duration_ms": int(time.time() * 1000) - step_start, "bytes": len(file_bytes)})

        # Step 2: Docling parsing
        step_start = int(time.time() * 1000)
        _log(logging.INFO, "Step: docling", ctx)
        docling_output = parse_document(file_bytes, filename)
        docling_markdown: str = docling_output.get("markdown", "")
        docling_fields: dict[str, Any] = docling_output.get("fields", {})

        # Guard: if Docling returns empty content with no error, flag it
        if not docling_markdown and not docling_fields:
            _log(logging.WARNING, "Docling returned empty content", {**ctx, "filename": filename})

        agent_steps.append("docling")
        _log(logging.INFO, "Step complete: docling", {**ctx, "duration_ms": int(time.time() * 1000) - step_start, "markdown_len": len(docling_markdown)})

        # Step 3: LLM reasoning (only if schema defined)
        llm_fields: dict[str, Any] = {}
        tokens_input = 0
        tokens_output = 0
        if schema:
            step_start = int(time.time() * 1000)
            _log(logging.INFO, "Step: llm_reasoning", {**ctx, "schema_fields": len(schema)})
            llm_fields, tokens_input, tokens_output = extract_fields(
                docling_markdown, schema, prompt_version
            )
            agent_steps.append("llm_reasoning")
            _log(logging.INFO, "Step complete: llm_reasoning", {
                **ctx,
                "duration_ms": int(time.time() * 1000) - step_start,
                "tokens_in": tokens_input,
                "tokens_out": tokens_output,
            })

        # Step 4: Reconciliation
        step_start = int(time.time() * 1000)
        _log(logging.INFO, "Step: reconciliation", ctx)
        recon = reconcile(docling_fields, llm_fields, hitl_threshold)
        agent_steps.append("reconciliation")
        _log(logging.INFO, "Step complete: reconciliation", {
            **ctx,
            "duration_ms": int(time.time() * 1000) - step_start,
            "overall_confidence": recon.overall_confidence,
            "hitl_required": recon.hitl_required,
            "field_count": len(recon.fields),
        })

        latency_ms = int(time.time() * 1000) - start_ms

        final_status = (
            TraceStatus.hitl_required if recon.hitl_required else TraceStatus.completed
        )
        if recon.hitl_required:
            agent_steps.append("hitl_flagged")

        result.status = final_status
        result.fields = recon.fields
        result.overall_confidence = recon.overall_confidence
        result.tokens_input = tokens_input
        result.tokens_output = tokens_output
        result.latency_ms = float(latency_ms)
        result.agent_steps = agent_steps

        _update_trace(
            trace_id,
            {
                "status": final_status,
                "confidence": str(recon.overall_confidence),
                "tokens": tokens_input + tokens_output,
                "latency": str(latency_ms),
                "agent_steps": agent_steps,
                "fields": [f.model_dump() for f in recon.fields],
                "hitl_required": recon.hitl_required,
            },
            ctx,
        )
        _log(logging.INFO, "Processing completed", {
            **ctx,
            "status": str(final_status),
            "confidence": recon.overall_confidence,
            "latency_ms": latency_ms,
        })

        # G5-12: Publish terminal state event so webhooks and integrations are notified
        _publish_trace_event(trace_id, tenant_id, workspace_id, str(final_status), None, ctx)

    except (DoclingError, LLMError, ClientError, Exception) as exc:
        latency_ms = int(time.time() * 1000) - start_ms
        agent_steps.append("error")
        error_code = _classify_error(exc)  # G5-08: structured error code
        result.status = TraceStatus.failed
        result.error = str(exc)
        result.error_code = error_code
        result.latency_ms = float(latency_ms)
        result.agent_steps = agent_steps

        _log(logging.ERROR, "Processing failed", {
            **ctx,
            "error": str(exc),
            "error_type": type(exc).__name__,
            "error_code": error_code,
            "latency_ms": latency_ms,
        }, exc_info=True)

        _update_trace(
            trace_id,
            {
                "status": TraceStatus.failed,
                "error": str(exc),
                "error_code": error_code,  # G5-08: persist structured code
                "latency": str(latency_ms),
                "agent_steps": agent_steps,
            },
            ctx,
        )

        # G5-12: Publish failure event so webhooks are notified of the error
        _publish_trace_event(trace_id, tenant_id, workspace_id, str(TraceStatus.failed), error_code, ctx)

    return result.model_dump()


def _log(level: int, message: str, extra: dict[str, Any], exc_info: bool = False) -> None:
    """Emit a structured log entry with context fields."""
    record = logger.makeRecord(
        logger.name, level, "(unknown)", 0, message, (), None
    )
    record.extra = extra  # type: ignore[attr-defined]
    if exc_info:
        import sys
        record.exc_info = sys.exc_info()
    logger.handle(record)


def _download_s3(s3_key: str) -> bytes:
    """Download from S3 with retry on transient errors."""
    for attempt in range(_MAX_RETRIES):
        try:
            response = _s3.get_object(Bucket=DOCUMENTS_BUCKET, Key=s3_key)
            return response["Body"].read()
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            # Non-retryable: key doesn't exist
            if code in ("NoSuchKey", "AccessDenied"):
                raise DoclingError(f"S3 object not found or access denied: {s3_key} [{code}]") from e
            # Retryable: throttle or transient
            if attempt < _MAX_RETRIES - 1:
                _sleep_backoff(attempt)
            else:
                raise DoclingError(f"S3 download failed after {_MAX_RETRIES} attempts: {e}") from e
    raise DoclingError("S3 download failed unexpectedly")  # should never reach


def _to_decimal(obj: Any) -> Any:
    """Recursively convert float values to Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_decimal(v) for v in obj]
    return obj


def _update_trace(trace_id: str, updates: dict[str, Any], ctx: dict[str, Any]) -> None:
    """Update a trace record in DynamoDB with retry on throttling."""
    expr_parts = []
    names: dict[str, str] = {}
    values: dict[str, Any] = {}

    for i, (k, v) in enumerate(updates.items()):
        alias = f"#f{i}"
        val_alias = f":v{i}"
        names[alias] = k
        values[val_alias] = _to_decimal(v)
        expr_parts.append(f"{alias} = {val_alias}")

    for attempt in range(_MAX_RETRIES):
        try:
            _traces.update_item(
                Key={"trace_id": trace_id},
                UpdateExpression="SET " + ", ".join(expr_parts),
                ExpressionAttributeNames=names,
                ExpressionAttributeValues=values,
            )
            return
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("ProvisionedThroughputExceededException", "RequestLimitExceeded", "ThrottlingException"):
                if attempt < _MAX_RETRIES - 1:
                    _sleep_backoff(attempt)
                    continue
            _log(logging.ERROR, "DynamoDB update failed", {
                **ctx,
                "attempt": attempt + 1,
                "error": str(e),
            })
            raise  # re-raise non-retryable or exhausted retries
