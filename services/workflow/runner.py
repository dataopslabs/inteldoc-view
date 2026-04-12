"""
DocOps Workflow Runner — Phase 3.

Orchestrates the full document processing pipeline using the state machine.
Replaces the Phase 2 processor/handler.py with formal state-tracked execution.

Pipeline:
  submitted → downloading → parsing (Docling) → reasoning (LLM)
           → reconciling → validating → hitl_pending | completed | failed
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

from .state_machine import WorkflowState, WorkflowStateMachine
from .validation_service import validate_output

# Reuse Phase 2 pipeline components
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from processor.docling_client import parse_document, DoclingError
from processor.llm_reasoning import extract_fields, LLMError
from processor.reconciliation import reconcile

import boto3

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

DOCUMENTS_BUCKET = os.environ.get("DOCUMENTS_BUCKET", "")
_s3 = boto3.client("s3")

HITL_TABLE = os.environ.get("HITL_REVIEWS_TABLE", "docops-hitl-reviews")
_dynamodb = boto3.resource("dynamodb")
hitl_table = _dynamodb.Table(HITL_TABLE)


def create_hitl_review(trace_id: str, workspace_id: str) -> None:
    """Create a pending HITL review record for a trace flagged as hitl_required."""
    try:
        hitl_table.put_item(
            Item={
                "trace_id": trace_id,
                "workspace_id": workspace_id,
                "status": "pending",
                "corrections": [],
                "created_at": datetime.utcnow().isoformat(),
            },
            ConditionExpression="attribute_not_exists(trace_id)",
        )
    except _dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        logger.warning("HITL review already exists for trace %s", trace_id)


def run_workflow(event: dict[str, Any]) -> dict[str, Any]:
    """
    Execute the full document processing workflow for a given trace event.

    Expected event keys:
      trace_id, workspace_id, s3_key, filename,
      schema, hitl_threshold, prompt_version
    """
    trace_id: str = event["trace_id"]
    workspace_id: str = event["workspace_id"]
    s3_key: str = event["s3_key"]
    filename: str = event.get("filename", "document")
    schema: dict[str, Any] = event.get("schema") or {}
    hitl_threshold: float = float(event.get("hitl_threshold", 0.8))
    prompt_version: str = event.get("prompt_version", "1.0.0")

    sm = WorkflowStateMachine(trace_id, initial_state=WorkflowState.submitted)
    start_ms = time.time() * 1000

    # ── Stage 1: Download ──────────────────────────────────────────────────
    sm.transition(WorkflowState.downloading)
    try:
        file_bytes = _download_s3(s3_key)
        logger.info("[%s] Downloaded %s (%d bytes)", trace_id, s3_key, len(file_bytes))
    except Exception as exc:
        _fail(sm, exc, start_ms)
        return _result(sm, trace_id, workspace_id, prompt_version, start_ms)

    # ── Stage 2: Docling parsing ───────────────────────────────────────────
    sm.transition(WorkflowState.parsing)
    try:
        docling_output = parse_document(file_bytes, filename)
        docling_markdown: str = docling_output.get("markdown", "")
        docling_fields: dict[str, Any] = docling_output.get("fields", {})
        logger.info("[%s] Docling parsed %d chars markdown, %d fields",
                    trace_id, len(docling_markdown), len(docling_fields))
    except DoclingError as exc:
        _fail(sm, exc, start_ms)
        return _result(sm, trace_id, workspace_id, prompt_version, start_ms, error=str(exc))

    # ── Stage 3: LLM Reasoning ────────────────────────────────────────────
    sm.transition(WorkflowState.reasoning)
    llm_fields: dict[str, Any] = {}
    tokens_input = tokens_output = 0
    if schema:
        try:
            llm_fields, tokens_input, tokens_output = extract_fields(
                docling_markdown, schema, prompt_version
            )
            logger.info("[%s] LLM extracted %d fields (%d+%d tokens)",
                        trace_id, len(llm_fields), tokens_input, tokens_output)
        except LLMError as exc:
            _fail(sm, exc, start_ms)
            return _result(sm, trace_id, workspace_id, prompt_version, start_ms,
                           tokens_input=tokens_input, tokens_output=tokens_output, error=str(exc))
    else:
        logger.info("[%s] No schema defined — skipping LLM reasoning", trace_id)

    # ── Stage 4: Reconciliation ───────────────────────────────────────────
    sm.transition(WorkflowState.reconciling)
    recon = reconcile(docling_fields, llm_fields, hitl_threshold)
    logger.info("[%s] Reconciliation: confidence=%.3f hitl=%s conflicts=%d",
                trace_id, recon.overall_confidence, recon.hitl_required,
                sum(1 for f in recon.fields if f.conflict))

    # ── Stage 5: Validation ───────────────────────────────────────────────
    sm.transition(WorkflowState.validating)
    extracted_final = {f.field: f.final_value for f in recon.fields}
    val_result = validate_output(extracted_final, schema)

    if not val_result.valid:
        error_summary = "; ".join(f"{e.field}: {e.message}" for e in val_result.errors)
        logger.warning("[%s] Validation errors: %s", trace_id, error_summary)

    latency_ms = (time.time() * 1000) - start_ms

    # Apply coercions to final field values
    coerced_fields = recon.fields
    if val_result.coerced_fields:
        coerced_fields = [
            f.model_copy(update={"final_value": val_result.coerced_fields[f.field]})
            if f.field in val_result.coerced_fields else f
            for f in recon.fields
        ]

    # ── Stage 6: Terminal state ───────────────────────────────────────────
    if recon.hitl_required or not val_result.valid:
        next_state = WorkflowState.hitl_pending
    else:
        next_state = WorkflowState.completed

    sm.transition(
        next_state,
        metadata={
            "confidence": str(recon.overall_confidence),
            "tokens": tokens_input + tokens_output,
            "latency": str(round(latency_ms, 2)),
            "fields": [f.model_dump() for f in coerced_fields],
            "hitl_required": recon.hitl_required,
            "validation_errors": [
                {"field": e.field, "message": e.message} for e in val_result.errors
            ],
            "validation_warnings": val_result.warnings,
        },
    )

    if next_state == WorkflowState.hitl_pending:
        create_hitl_review(trace_id, workspace_id)

    logger.info("[%s] Workflow complete — state=%s confidence=%.3f latency=%.0fms",
                trace_id, next_state.value, recon.overall_confidence, latency_ms)

    return {
        "trace_id": trace_id,
        "workspace_id": workspace_id,
        "status": sm.api_status,
        "workflow_state": sm.current_state.value,
        "confidence": recon.overall_confidence,
        "tokens": tokens_input + tokens_output,
        "latency_ms": round(latency_ms, 2),
        "fields": [f.model_dump() for f in coerced_fields],
        "validation_errors": [{"field": e.field, "message": e.message} for e in val_result.errors],
    }


def _fail(sm: WorkflowStateMachine, exc: Exception, start_ms: float) -> None:
    latency_ms = (time.time() * 1000) - start_ms
    logger.exception("Workflow failed at state=%s", sm.current_state.value)
    try:
        sm.transition(
            WorkflowState.failed,
            metadata={"error": str(exc), "latency": str(round(latency_ms, 2))},
        )
    except Exception:
        pass


def _result(
    sm: WorkflowStateMachine,
    trace_id: str,
    workspace_id: str,
    prompt_version: str,
    start_ms: float,
    *,
    tokens_input: int = 0,
    tokens_output: int = 0,
    error: str | None = None,
) -> dict[str, Any]:
    latency_ms = (time.time() * 1000) - start_ms
    return {
        "trace_id": trace_id,
        "workspace_id": workspace_id,
        "status": sm.api_status,
        "workflow_state": sm.current_state.value,
        "latency_ms": round(latency_ms, 2),
        "tokens": tokens_input + tokens_output,
        "error": error,
    }


def _download_s3(s3_key: str) -> bytes:
    response = _s3.get_object(Bucket=DOCUMENTS_BUCKET, Key=s3_key)
    return response["Body"].read()
