"""
DocOps Workflow State Machine.

States and valid transitions for the document processing pipeline.

State diagram:
  submitted → downloading → parsing → reasoning → reconciling → validating
                                                                      ↓
                                                          hitl_pending | completed
                                                                ↓
                                                            resolved → completed
  Any state → failed (on unrecoverable error)
"""
from __future__ import annotations

from enum import Enum
from datetime import datetime, timezone
from typing import Any
import boto3
import os

TRACES_TABLE = os.environ.get("TRACES_TABLE", "docops-traces")
_dynamodb = boto3.resource("dynamodb", region_name=os.environ.get("AWS_REGION_NAME", "us-east-1"))


class WorkflowState(str, Enum):
    submitted = "submitted"
    downloading = "downloading"
    parsing = "parsing"          # Docling
    reasoning = "reasoning"      # Bedrock LLM
    reconciling = "reconciling"
    validating = "validating"
    hitl_pending = "hitl_pending"
    completed = "completed"
    failed = "failed"


# Valid forward transitions
TRANSITIONS: dict[WorkflowState, list[WorkflowState]] = {
    WorkflowState.submitted: [WorkflowState.downloading, WorkflowState.failed],
    WorkflowState.downloading: [WorkflowState.parsing, WorkflowState.failed],
    WorkflowState.parsing: [WorkflowState.reasoning, WorkflowState.failed],
    WorkflowState.reasoning: [WorkflowState.reconciling, WorkflowState.failed],
    WorkflowState.reconciling: [WorkflowState.validating, WorkflowState.failed],
    WorkflowState.validating: [
        WorkflowState.hitl_pending,
        WorkflowState.completed,
        WorkflowState.failed,
    ],
    WorkflowState.hitl_pending: [WorkflowState.completed, WorkflowState.failed],
    WorkflowState.completed: [],
    WorkflowState.failed: [],
}

# States that map to the legacy "status" field visible in the API
STATE_TO_STATUS: dict[WorkflowState, str] = {
    WorkflowState.submitted: "pending",
    WorkflowState.downloading: "processing",
    WorkflowState.parsing: "processing",
    WorkflowState.reasoning: "processing",
    WorkflowState.reconciling: "processing",
    WorkflowState.validating: "processing",
    WorkflowState.hitl_pending: "hitl_required",
    WorkflowState.completed: "completed",
    WorkflowState.failed: "failed",
}


class WorkflowStateMachine:
    """
    Manages state transitions for a single trace, persisting each step to DynamoDB.
    """

    def __init__(self, trace_id: str, initial_state: WorkflowState = WorkflowState.submitted):
        self.trace_id = trace_id
        self.current_state = initial_state
        self._table = _dynamodb.Table(TRACES_TABLE)
        self._steps: list[dict[str, Any]] = []

    def transition(self, new_state: WorkflowState, metadata: dict[str, Any] | None = None) -> None:
        """
        Transition to a new state. Raises ValueError if the transition is invalid.
        Persists the new state and appends a step entry to DynamoDB.
        """
        allowed = TRANSITIONS.get(self.current_state, [])
        if new_state not in allowed:
            raise ValueError(
                f"Invalid transition: {self.current_state} → {new_state}. "
                f"Allowed: {[s.value for s in allowed]}"
            )

        step_entry: dict[str, Any] = {
            "from": self.current_state.value,
            "to": new_state.value,
            "at": datetime.now(timezone.utc).isoformat(),
        }
        if metadata:
            step_entry["meta"] = metadata

        self._steps.append(step_entry)
        self.current_state = new_state

        updates: dict[str, Any] = {
            "workflow_state": new_state.value,
            "status": STATE_TO_STATUS[new_state],
            "workflow_steps": self._steps,
        }
        if metadata:
            updates.update(metadata)

        self._persist(updates)

    def _persist(self, updates: dict[str, Any]) -> None:
        expr_parts = []
        names: dict[str, str] = {}
        values: dict[str, Any] = {}

        for i, (k, v) in enumerate(updates.items()):
            alias = f"#f{i}"
            val_alias = f":v{i}"
            names[alias] = k
            values[val_alias] = v
            expr_parts.append(f"{alias} = {val_alias}")

        self._table.update_item(
            Key={"trace_id": self.trace_id},
            UpdateExpression="SET " + ", ".join(expr_parts),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )

    @property
    def is_terminal(self) -> bool:
        return self.current_state in (WorkflowState.completed, WorkflowState.failed)

    @property
    def api_status(self) -> str:
        return STATE_TO_STATUS[self.current_state]
