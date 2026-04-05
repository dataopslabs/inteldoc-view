"""
DocOps Processing Lambda — Phase 2 Document Processing Pipeline.

Invoked asynchronously by the API Lambda with:
{
  "trace_id": str,
  "workspace_id": str,
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
from typing import Any

import boto3
from botocore.exceptions import ClientError

from .docling_client import parse_document, DoclingError
from .llm_reasoning import extract_fields, LLMError
from .reconciliation import reconcile
from .models import TraceStatus, ProcessingResult

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TRACES_TABLE = os.environ["TRACES_TABLE"]
WORKSPACES_TABLE = os.environ["WORKSPACES_TABLE"]
DOCUMENTS_BUCKET = os.environ["DOCUMENTS_BUCKET"]

_dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION_NAME", "us-east-1"))
_s3 = boto3.client("s3")
_traces = _dynamodb.Table(TRACES_TABLE)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    trace_id: str = event["trace_id"]
    workspace_id: str = event["workspace_id"]
    s3_key: str = event["s3_key"]
    filename: str = event.get("filename", "document")
    schema: dict[str, Any] = event.get("schema") or {}
    hitl_threshold: float = float(event.get("hitl_threshold", 0.8))
    prompt_version: str = event.get("prompt_version", "1.0.0")

    start_ms = time.time() * 1000
    agent_steps: list[str] = []
    result = ProcessingResult(
        trace_id=trace_id,
        workspace_id=workspace_id,
        status=TraceStatus.processing,
        prompt_version=prompt_version,
    )

    _update_trace(trace_id, {"status": TraceStatus.processing})

    try:
        # Step 1: Download document from S3
        logger.info("Downloading %s from S3", s3_key)
        file_bytes = _download_s3(s3_key)
        agent_steps.append("s3_download")

        # Step 2: Docling parsing
        logger.info("Sending to Docling")
        docling_output = parse_document(file_bytes, filename)
        docling_markdown: str = docling_output.get("markdown", "")
        docling_fields: dict[str, Any] = docling_output.get("fields", {})
        agent_steps.append("docling")

        # Step 3: LLM reasoning (only if schema defined)
        llm_fields: dict[str, Any] = {}
        tokens_input = 0
        tokens_output = 0
        if schema:
            logger.info("Running LLM reasoning on %d schema fields", len(schema))
            llm_fields, tokens_input, tokens_output = extract_fields(
                docling_markdown, schema, prompt_version
            )
            agent_steps.append("llm_reasoning")

        # Step 4: Reconciliation
        logger.info("Reconciling pipeline outputs")
        recon = reconcile(docling_fields, llm_fields, hitl_threshold)
        agent_steps.append("reconciliation")

        latency_ms = (time.time() * 1000) - start_ms

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
        result.latency_ms = round(latency_ms, 2)
        result.agent_steps = agent_steps

        _update_trace(
            trace_id,
            {
                "status": final_status,
                "confidence": str(recon.overall_confidence),
                "tokens": tokens_input + tokens_output,
                "latency": str(round(latency_ms, 2)),
                "agent_steps": agent_steps,
                "fields": [f.model_dump() for f in recon.fields],
                "hitl_required": recon.hitl_required,
            },
        )
        logger.info(
            "Trace %s completed — status=%s confidence=%.3f latency=%.0fms",
            trace_id, final_status, recon.overall_confidence, latency_ms,
        )

    except (DoclingError, LLMError, ClientError, Exception) as exc:
        logger.exception("Processing failed for trace %s", trace_id)
        latency_ms = (time.time() * 1000) - start_ms
        agent_steps.append("error")
        result.status = TraceStatus.failed
        result.error = str(exc)
        result.latency_ms = round(latency_ms, 2)
        result.agent_steps = agent_steps

        _update_trace(
            trace_id,
            {
                "status": TraceStatus.failed,
                "error": str(exc),
                "latency": str(round(latency_ms, 2)),
                "agent_steps": agent_steps,
            },
        )

    return result.model_dump()


def _download_s3(s3_key: str) -> bytes:
    response = _s3.get_object(Bucket=DOCUMENTS_BUCKET, Key=s3_key)
    return response["Body"].read()


def _update_trace(trace_id: str, updates: dict[str, Any]) -> None:
    expr_parts = []
    names: dict[str, str] = {}
    values: dict[str, Any] = {}

    for i, (k, v) in enumerate(updates.items()):
        alias = f"#f{i}"
        val_alias = f":v{i}"
        names[alias] = k
        values[val_alias] = v
        expr_parts.append(f"{alias} = {val_alias}")

    _traces.update_item(
        Key={"trace_id": trace_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
