"""AWS Bedrock LLM reasoning service with prompt versioning."""
from __future__ import annotations

import json
import os
import time
import boto3
from typing import Any

BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0"
)
AWS_REGION = os.environ.get("AWS_REGION_NAME", "us-east-1")

_bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)

PROMPT_TEMPLATE = """You are an intelligent document processing agent.

Document content:
{docling_markdown}

Extract fields based on the following schema:
{schema}

Instructions:
- Return a valid JSON object with one key per schema field.
- For each field, provide the extracted value exactly as it appears in the document.
- If a field is not found, use null.
- Do not add extra keys or commentary outside the JSON.

Return ONLY the JSON object, nothing else."""


class LLMError(Exception):
    pass


def extract_fields(
    docling_markdown: str,
    schema: dict[str, Any],
    prompt_version: str = "1.0.0",
) -> tuple[dict[str, Any], int, int]:
    """
    Call Bedrock to extract fields from the Docling markdown.

    Returns:
        (fields_dict, input_tokens, output_tokens)
    """
    prompt = PROMPT_TEMPLATE.format(
        docling_markdown=docling_markdown[:8000],  # guard against context overflow
        schema=json.dumps(schema, indent=2),
    )

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "messages": [{"role": "user", "content": prompt}],
    }

    try:
        response = _bedrock.invoke_model(
            modelId=BEDROCK_MODEL_ID,
            body=json.dumps(body),
            contentType="application/json",
            accept="application/json",
        )
        result = json.loads(response["body"].read())
        text = result["content"][0]["text"].strip()
        input_tokens: int = result.get("usage", {}).get("input_tokens", 0)
        output_tokens: int = result.get("usage", {}).get("output_tokens", 0)

        # Parse JSON from the model response
        fields = _parse_json_response(text)
        return fields, input_tokens, output_tokens

    except Exception as e:
        raise LLMError(f"Bedrock invocation failed: {e}") from e


def _parse_json_response(text: str) -> dict[str, Any]:
    """Extract JSON from model output, handling markdown code fences."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMError(f"Could not parse model JSON output: {e}\nOutput was: {text[:500]}") from e
