"""Amazon Bedrock LLM reasoning service for structured field extraction."""
from __future__ import annotations

import json
import os

import boto3
from botocore.exceptions import ClientError

from services.exceptions import LLMError, LLMParsingError
from services.models import ExtractedField, ExtractionResult


class LLMReasoningService:
    """Wrapper around Amazon Bedrock InvokeModel for structured field extraction."""

    def __init__(
        self,
        model_id: str | None = None,
        region: str | None = None,
    ) -> None:
        self.model_id = model_id or os.environ.get("BEDROCK_MODEL_ID", "")
        self.client = boto3.client(
            "bedrock-runtime",
            region_name=region or os.environ.get("AWS_REGION", "us-east-1"),
        )

    def extract_fields(self, parsed_text: str, schema: dict) -> ExtractionResult:
        """Extract structured fields from parsed text using the workspace schema.

        Args:
            parsed_text: Document text returned by the Docling service.
            schema: Workspace schema with a ``fields`` list of
                ``{"name": str, "type": str, "description": str}`` entries.

        Returns:
            :class:`ExtractionResult` with extracted fields and token counts.

        Raises:
            LLMError: On Bedrock API errors.
            LLMParsingError: When the LLM response is not valid JSON or
                lacks the expected ``fields`` structure.
        """
        system_prompt = self._build_system_prompt()
        user_prompt = self._build_user_prompt(parsed_text, schema)

        request_body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": [
                {"role": "user", "content": user_prompt},
            ],
        })

        try:
            response = self.client.invoke_model(
                modelId=self.model_id,
                contentType="application/json",
                accept="application/json",
                body=request_body,
            )
        except ClientError as exc:
            error_code = exc.response["Error"]["Code"]
            error_message = exc.response["Error"]["Message"]
            raise LLMError(error_code, error_message) from exc

        response_body = json.loads(response["body"].read())
        return self._parse_response(response_body)

    # ------------------------------------------------------------------
    # Prompt construction
    # ------------------------------------------------------------------

    @staticmethod
    def _build_system_prompt() -> str:
        return (
            "You are a document field extraction assistant. "
            "Extract the requested fields from the provided document text. "
            "Return a JSON object with a single key \"fields\" containing an array. "
            "Each element must have:\n"
            "- \"field_name\": the name of the field\n"
            "- \"value\": the extracted value (use null if not found)\n"
            "- \"confidence\": a float between 0.0 and 1.0 indicating your certainty\n\n"
            "Return ONLY the JSON object, no additional text."
        )

    @staticmethod
    def _build_user_prompt(parsed_text: str, schema: dict) -> str:
        schema_fields = schema.get("fields", [])
        field_descriptions: list[str] = []
        for field in schema_fields:
            name = field.get("name", "")
            ftype = field.get("type", "string")
            desc = field.get("description", "")
            field_descriptions.append(
                f"- {name} ({ftype}): {desc}"
            )

        fields_section = "\n".join(field_descriptions) if field_descriptions else "(no fields defined)"

        return (
            "## Document Text\n\n"
            f"{parsed_text}\n\n"
            "## Fields to Extract\n\n"
            f"{fields_section}"
        )

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_response(response_body: dict) -> ExtractionResult:
        """Parse the Bedrock response body into an ExtractionResult."""
        # Extract token usage from the response
        usage = response_body.get("usage", {})
        input_tokens = usage.get("input_tokens", 0)
        output_tokens = usage.get("output_tokens", 0)

        # Extract the text content from the response
        content = response_body.get("content", [])
        if not content:
            raise LLMParsingError("")

        raw_text = content[0].get("text", "")

        # Parse the JSON from the LLM response text
        try:
            parsed = json.loads(raw_text)
        except (json.JSONDecodeError, TypeError):
            raise LLMParsingError(raw_text)

        # Validate the expected structure
        if not isinstance(parsed, dict) or "fields" not in parsed:
            raise LLMParsingError(raw_text)

        raw_fields = parsed["fields"]
        if not isinstance(raw_fields, list):
            raise LLMParsingError(raw_text)

        fields: list[ExtractedField] = []
        for item in raw_fields:
            if (
                not isinstance(item, dict)
                or "field_name" not in item
                or "value" not in item
                or "confidence" not in item
            ):
                raise LLMParsingError(raw_text)
            fields.append(
                ExtractedField(
                    field_name=item["field_name"],
                    value=item["value"],
                    confidence=float(item["confidence"]),
                )
            )

        return ExtractionResult(
            fields=fields,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
