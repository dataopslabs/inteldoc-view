"""Strands agent definitions for the DocOps Workflow Engine.

Provides a shared model-provider helper used by all agent factory modules
(parsing, extraction, validation, reconciliation).
"""
from __future__ import annotations

import os

from strands.models.bedrock import BedrockModel

DEFAULT_MODEL_ID: str = os.environ.get(
    "BEDROCK_MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0"
)


def _get_model_provider(model_id: str | None = None) -> BedrockModel:
    """Return a :class:`BedrockModel` configured for the given *model_id*.

    Parameters
    ----------
    model_id:
        Amazon Bedrock model identifier.  Falls back to the
        ``BEDROCK_MODEL_ID`` environment variable, then to
        ``anthropic.claude-3-haiku-20240307-v1:0``.

    Returns
    -------
    BedrockModel
        A Strands SDK model provider ready for use with an ``Agent``.
    """
    return BedrockModel(
        model_id=model_id or DEFAULT_MODEL_ID,
        region_name=os.environ.get("AWS_REGION_NAME", "us-east-1"),
    )
