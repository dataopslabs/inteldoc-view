"""Extraction Agent — wraps the LLM reasoning service as a Strands tool."""
from __future__ import annotations

from strands import Agent, tool

from services.llm_reasoning import LLMReasoningService
from services.workflow.agents import _get_model_provider


@tool
def extract(parsed_text: str, schema: dict) -> dict:
    """Extract structured fields from parsed text using Bedrock LLM.

    Args:
        parsed_text: Document text returned by the parsing stage.
        schema: Workspace schema describing the fields to extract.

    Returns:
        Dict with ``fields``, ``input_tokens``, and ``output_tokens``.
    """
    svc = LLMReasoningService()
    result = svc.extract_fields(parsed_text, schema)
    return {
        "fields": [f.model_dump() for f in result.fields],
        "input_tokens": result.input_tokens,
        "output_tokens": result.output_tokens,
    }


def create_extraction_agent(system_prompt: str, model_id: str | None = None) -> Agent:
    """Create an Extraction Agent with the LLM reasoning tool.

    Parameters
    ----------
    system_prompt:
        The system prompt describing extraction responsibilities.
    model_id:
        Optional Bedrock model identifier override.

    Returns
    -------
    Agent
        A Strands Agent configured with the ``extract`` tool.
    """
    return Agent(
        system_prompt=system_prompt,
        tools=[extract],
        model=_get_model_provider(model_id),
    )
