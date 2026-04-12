"""
DocOps Workflow Lambda entry point — Phase 3.

Replaces services/processor/handler.py.
Invoked asynchronously by the API Lambda with the same event schema.

Delegates to the WorkflowOrchestrator which executes the configurable
agent chain (Strands Agents SDK) instead of the Phase 2 linear pipeline.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import boto3

from .models import ProcessingEvent
from .orchestrator import WorkflowOrchestrator

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

WORKSPACES_TABLE = os.environ.get("WORKSPACES_TABLE", "docops-workspaces")
_dynamodb = boto3.resource("dynamodb")


def _load_workspace(workspace_id: str) -> dict[str, Any]:
    """Load workspace configuration from DynamoDB."""
    table = _dynamodb.Table(WORKSPACES_TABLE)
    response = table.get_item(Key={"workspace_id": workspace_id})
    item = response.get("Item")
    if not item:
        raise ValueError(f"Workspace not found: {workspace_id}")
    return item


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Lambda entry point — delegates to WorkflowOrchestrator."""
    logger.info(
        "Workflow event: trace_id=%s workspace_id=%s filename=%s",
        event.get("trace_id"),
        event.get("workspace_id"),
        event.get("filename"),
    )

    workspace_id = event.get("workspace_id", "")
    workspace = _load_workspace(workspace_id)

    processing_event = ProcessingEvent(**event)
    orchestrator = WorkflowOrchestrator(processing_event, workspace)
    result = orchestrator.run()

    return result.to_api_response()
