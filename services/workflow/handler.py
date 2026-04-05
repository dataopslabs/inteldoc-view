"""
DocOps Workflow Lambda entry point — Phase 3.

Replaces services/processor/handler.py.
Invoked asynchronously by the API Lambda with the same event schema.
"""
from __future__ import annotations

import logging
from typing import Any

from .runner import run_workflow

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    logger.info("Workflow event: trace_id=%s workspace_id=%s filename=%s",
                event.get("trace_id"), event.get("workspace_id"), event.get("filename"))
    return run_workflow(event)
