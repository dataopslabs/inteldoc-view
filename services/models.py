"""Shared Pydantic models mirroring the DynamoDB data model."""
from __future__ import annotations

from enum import Enum
from typing import Any
from pydantic import BaseModel, Field
from datetime import datetime


class Plan(str, Enum):
    free = "free"
    pro = "pro"
    enterprise = "enterprise"


class TraceStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"
    hitl_required = "hitl_required"


class HitlStatus(str, Enum):
    pending = "pending"
    in_review = "in_review"
    resolved = "resolved"


class Tenant(BaseModel):
    tenant_id: str
    email: str
    plan: Plan = Plan.free
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Workspace(BaseModel):
    workspace_id: str
    tenant_id: str
    name: str
    description: str | None = None
    prompt_version: str = "1.0.0"
    schema_: dict[str, Any] | None = Field(None, alias="schema")
    agents: list[str | dict] = Field(default_factory=list)
    secondary_model_id: str | None = None
    hitl_threshold: float = 0.8
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Trace(BaseModel):
    trace_id: str
    workspace_id: str
    status: TraceStatus = TraceStatus.pending
    confidence: float | None = None
    tokens: int | None = None
    latency: float | None = None
    agent_steps: list[Any] = Field(default_factory=list)
    prompt_version: str = "1.0.0"
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Session(BaseModel):
    session_id: str
    workspace_id: str
    memory: list[Any] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class HitlReview(BaseModel):
    trace_id: str
    status: HitlStatus = HitlStatus.pending
    reviewer: str | None = None
    corrections: list[Any] = Field(default_factory=list)
    resolved_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


# --- Document Processing Pipeline Models ---


class ProcessingEvent(BaseModel):
    """Lambda invocation event for the document processing pipeline."""
    trace_id: str
    workspace_id: str
    s3_key: str
    filename: str
    schema_: dict[str, Any] = Field(default_factory=dict, alias="schema")
    hitl_threshold: float = 0.8
    prompt_version: str = "1.0.0"


class ExtractedField(BaseModel):
    """A single field extracted by the LLM with its confidence score."""
    field_name: str
    value: Any
    confidence: float = Field(ge=0.0, le=1.0)


class ExtractionResult(BaseModel):
    """Result from the LLM reasoning service containing extracted fields and token usage."""
    fields: list[ExtractedField]
    input_tokens: int
    output_tokens: int
