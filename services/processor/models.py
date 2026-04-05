"""Data models for the processing pipeline."""
from __future__ import annotations

from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


class TraceStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"
    hitl_required = "hitl_required"


class FieldResult(BaseModel):
    field: str
    docling_value: Any = None
    llm_value: Any = None
    final_value: Any = None
    confidence: float = 1.0
    conflict: bool = False


class ReconciliationResult(BaseModel):
    fields: list[FieldResult]
    overall_confidence: float
    hitl_required: bool


class ProcessingResult(BaseModel):
    trace_id: str
    workspace_id: str
    status: TraceStatus
    fields: list[FieldResult] = Field(default_factory=list)
    overall_confidence: float = 0.0
    tokens_input: int = 0
    tokens_output: int = 0
    latency_ms: float = 0.0
    agent_steps: list[str] = Field(default_factory=list)
    prompt_version: str = "1.0.0"
    error: str | None = None
