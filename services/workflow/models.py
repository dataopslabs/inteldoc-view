"""Data models for the Strands Workflow Engine (Phase 3).

Defines AgentStep, AgentConfig, ProcessingEvent, and WorkflowResult used by the
Workflow Orchestrator and agent chain execution.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ProcessingEvent(BaseModel):
    """Lambda invocation event for the document processing pipeline."""

    trace_id: str
    workspace_id: str
    s3_key: str
    filename: str
    schema: dict[str, Any] = Field(default_factory=dict)
    hitl_threshold: float = 0.8
    prompt_version: str = "1.0.0"


class AgentStep(BaseModel):
    """A record of a single agent's execution within the workflow chain.

    Stored in the trace's agent_steps array for monitoring and debugging.
    """

    agent_name: str
    model_id: str = "none"
    prompt_version: str = "1.0.0"
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: float = 0.0
    status: str = "success"  # "success" | "error"
    error_message: str | None = None


class AgentConfig(BaseModel):
    """Per-agent configuration within a workspace's agent chain."""

    agent_name: str
    model_id: str | None = None
    prompt_version: str | None = None


class WorkflowResult(BaseModel):
    """Final result of a workflow orchestrator run.

    Contains the trace outcome, extracted fields, agent step records,
    and aggregated metrics. Provides ``to_api_response()`` for Phase 2
    backward-compatible response shape.
    """

    trace_id: str
    workspace_id: str
    status: str  # "completed" | "hitl_required" | "failed"
    workflow_state: str
    confidence: float = 0.0
    tokens: int = 0
    latency_ms: float = 0.0
    fields: list[dict[str, Any]] = Field(default_factory=list)
    agent_steps: list[AgentStep] = Field(default_factory=list)
    validation_errors: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None

    def to_api_response(self) -> dict[str, Any]:
        """Return a Phase 2-compatible response dict."""
        return {
            "trace_id": self.trace_id,
            "workspace_id": self.workspace_id,
            "status": self.status,
            "workflow_state": self.workflow_state,
            "confidence": self.confidence,
            "tokens": self.tokens,
            "latency_ms": self.latency_ms,
            "fields": self.fields,
            "agent_steps": [step.model_dump() for step in self.agent_steps],
            "validation_errors": self.validation_errors,
        }
