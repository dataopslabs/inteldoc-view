"""Validation Agent — wraps the schema validation service as a Strands tool."""
from __future__ import annotations

from strands import Agent, tool

from services.workflow.validation_service import validate_output
from services.workflow.agents import _get_model_provider


@tool
def validate(extracted: dict, schema: dict) -> dict:
    """Validate extracted fields against the workspace schema.

    Args:
        extracted: Dict of extracted field values.
        schema: Workspace schema describing expected fields and types.

    Returns:
        Dict with ``valid``, ``errors``, ``coerced_fields``, and ``warnings``.
    """
    result = validate_output(extracted, schema)
    return {
        "valid": result.valid,
        "errors": [{"field": e.field, "message": e.message} for e in result.errors],
        "coerced_fields": result.coerced_fields,
        "warnings": result.warnings,
    }


def create_validation_agent(system_prompt: str, model_id: str | None = None) -> Agent:
    """Create a Validation Agent with the schema validation tool.

    Parameters
    ----------
    system_prompt:
        The system prompt describing validation responsibilities.
    model_id:
        Optional Bedrock model identifier override.

    Returns
    -------
    Agent
        A Strands Agent configured with the ``validate`` tool.
    """
    return Agent(
        system_prompt=system_prompt,
        tools=[validate],
        model=_get_model_provider(model_id),
    )
