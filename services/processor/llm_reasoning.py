"""AWS Bedrock LLM reasoning service with prompt versioning and retry."""
from __future__ import annotations

import json
import os
import time
import random
import boto3
from botocore.exceptions import ClientError
from typing import Any

BEDROCK_MODEL_ID = os.environ.get(
    "BEDROCK_MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0"
)
AWS_REGION = os.environ.get("AWS_REGION_NAME", "us-east-1")

_bedrock = boto3.client("bedrock-runtime", region_name=AWS_REGION)

# Retry config for Bedrock throttling
_MAX_RETRIES = 3
_BASE_BACKOFF_MS = 200

# G6-21: Prompt version registry — maps semantic version strings to prompt configurations.
# Add new versions here; never mutate existing entries (immutable versioned registry).
PROMPT_REGISTRY: dict[str, dict] = {
    "1.0.0": {
        "version": "1.0.0",
        "description": "Initial production prompt — flat JSON extraction",
        "template": (
            "You are an intelligent document processing agent.\n\n"
            "Document content:\n{docling_markdown}\n\n"
            "Extract fields based on the following schema:\n{schema}\n\n"
            "Instructions:\n"
            "- Return a valid JSON object with one key per schema field.\n"
            "- For each field, provide the extracted value exactly as it appears in the document.\n"
            "- If a field is not found, use null.\n"
            "- Do not add extra keys or commentary outside the JSON.\n\n"
            "Return ONLY the JSON object, nothing else."
        ),
        "max_tokens": 2048,
        "temperature": 0.0,
    },
    "1.1.0": {
        "version": "1.1.0",
        "description": "Improved prompt with confidence scores per field",
        "template": (
            "You are an intelligent document processing agent.\n\n"
            "Document content:\n{docling_markdown}\n\n"
            "Extract fields based on the following schema:\n{schema}\n\n"
            "Instructions:\n"
            "- Return a JSON object with two keys: 'fields' and 'confidence'.\n"
            "- 'fields': one key per schema field with the extracted value (null if not found).\n"
            "- 'confidence': one key per schema field with a float 0.0–1.0 confidence score.\n"
            "- Do not add extra keys or commentary outside the JSON.\n\n"
            "Return ONLY the JSON object, nothing else."
        ),
        "max_tokens": 3072,
        "temperature": 0.0,
    },
}

LATEST_PROMPT_VERSION = "1.0.0"


def get_prompt_config(version: str | None) -> dict:
    """
    Return prompt config for the given version string.
    Falls back to LATEST_PROMPT_VERSION if version is None or not registered.
    """
    if version and version in PROMPT_REGISTRY:
        return PROMPT_REGISTRY[version]
    if version:
        import logging as _logging
        _logging.warning(
            "Prompt version %r not in registry; falling back to %s. "
            "Available: %s",
            version, LATEST_PROMPT_VERSION, list(PROMPT_REGISTRY.keys()),
        )
    return PROMPT_REGISTRY[LATEST_PROMPT_VERSION]


class LLMError(Exception):
    pass


def extract_fields(
    docling_markdown: str,
    schema: dict[str, Any],
    prompt_version: str | None = None,
) -> tuple[dict[str, Any], int, int]:
    """
    Call Bedrock to extract fields from the Docling markdown.

    G6-21: Uses the PROMPT_REGISTRY to resolve the correct prompt template and
    parameters for the given version. Falls back to LATEST_PROMPT_VERSION if
    the requested version is not registered.

    Retries up to _MAX_RETRIES times with exponential backoff + jitter on throttling.

    Returns:
        (fields_dict, input_tokens, output_tokens)

    Raises:
        LLMError: on non-retryable errors or exhausted retries.
    """
    # G6-21: Resolve prompt config from registry
    prompt_config = get_prompt_config(prompt_version)
    prompt = prompt_config["template"].format(
        docling_markdown=docling_markdown[:8000],  # guard against context overflow
        schema=json.dumps(schema, indent=2),
    )

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": prompt_config.get("max_tokens", 2048),
        "messages": [{"role": "user", "content": prompt}],
    }

    last_error: Exception | None = None

    for attempt in range(_MAX_RETRIES):
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

            # Parse and type-check the model response
            fields = _parse_json_response(text)
            if not isinstance(fields, dict):
                raise LLMError(f"Model returned non-dict JSON: {type(fields).__name__}")
            return fields, input_tokens, output_tokens

        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            # Throttling and capacity errors are retryable
            if code in ("ThrottlingException", "ServiceUnavailableException",
                        "ModelNotReadyException", "RequestLimitExceeded"):
                last_error = e
                if attempt < _MAX_RETRIES - 1:
                    _sleep_backoff(attempt)
                    continue
                raise LLMError(
                    f"Bedrock throttled after {_MAX_RETRIES} attempts: {e}"
                ) from e
            # All other ClientErrors are non-retryable
            raise LLMError(f"Bedrock invocation failed [{code}]: {e}") from e

        except LLMError:
            raise  # parsing errors are not retryable

        except Exception as e:
            last_error = e
            if attempt < _MAX_RETRIES - 1:
                _sleep_backoff(attempt)
                continue
            raise LLMError(
                f"Bedrock invocation failed after {_MAX_RETRIES} attempts: {e}"
            ) from e

    raise LLMError(f"Bedrock failed after retries: {last_error}")


def _sleep_backoff(attempt: int) -> None:
    """Exponential backoff with jitter — prevents thundering herd on concurrent retries."""
    delay = (_BASE_BACKOFF_MS * (2 ** attempt) + random.randint(0, 100)) / 1000.0
    time.sleep(delay)


def _parse_json_response(text: str) -> dict[str, Any]:
    """Extract JSON from model output, handling markdown code fences."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
    try:
        parsed = json.loads(text)
        if not isinstance(parsed, dict):
            raise LLMError(f"Expected JSON object, got {type(parsed).__name__}")
        return parsed
    except json.JSONDecodeError as e:
        raise LLMError(
            f"Could not parse model JSON output: {e}\nOutput was: {text[:500]}"
        ) from e
