"""Parsing Agent — wraps the Docling document parsing service as a Strands tool."""
from __future__ import annotations

from strands import Agent, tool

from services.docling_client import DoclingClient
from services.workflow.agents import _get_model_provider


@tool
def parse_doc(file_bytes: bytes, filename: str) -> str:
    """Parse a document using the Docling service.

    Args:
        file_bytes: Raw document bytes.
        filename: Original filename for the document.

    Returns:
        Parsed text with page markers.
    """
    client = DoclingClient()
    return client.parse_document(file_bytes, filename)


def create_parsing_agent(system_prompt: str, model_id: str | None = None) -> Agent:
    """Create a Parsing Agent with the Docling tool.

    Parameters
    ----------
    system_prompt:
        The system prompt describing parsing responsibilities.
    model_id:
        Optional Bedrock model identifier override.

    Returns
    -------
    Agent
        A Strands Agent configured with the ``parse_doc`` tool.
    """
    return Agent(
        system_prompt=system_prompt,
        tools=[parse_doc],
        model=_get_model_provider(model_id),
    )
