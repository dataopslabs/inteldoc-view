"""Property and unit tests for the LLM Reasoning Service.

Feature: document-processing-pipeline
"""
from __future__ import annotations

import importlib
import json
import types

import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

from services.exceptions import LLMParsingError
from services.models import ExtractedField, ExtractionResult


def _load_llm_reasoning() -> types.ModuleType:
    """Import the llm-reasoning package (hyphenated directory name)."""
    loader = importlib.machinery.SourceFileLoader(
        "llm_reasoning",
        "services/llm-reasoning/__init__.py",
    )
    mod = types.ModuleType(loader.name)
    loader.exec_module(mod)
    return mod


_mod = _load_llm_reasoning()
LLMReasoningService = _mod.LLMReasoningService


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

field_name_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N")),
    min_size=1,
    max_size=50,
)

# Values the LLM might return for a field — strings, ints, floats, None
field_value_strategy = st.one_of(
    st.text(min_size=0, max_size=100),
    st.integers(min_value=-10_000, max_value=10_000),
    st.floats(allow_nan=False, allow_infinity=False, min_value=-1e6, max_value=1e6),
    st.none(),
)

confidence_strategy = st.floats(min_value=0.0, max_value=1.0, allow_nan=False)

extracted_field_strategy = st.fixed_dictionaries({
    "field_name": field_name_strategy,
    "value": field_value_strategy,
    "confidence": confidence_strategy,
})

token_count_strategy = st.integers(min_value=0, max_value=100_000)


def bedrock_response_strategy():
    """Generate a valid Bedrock response body with 1-10 fields and token counts."""
    return st.fixed_dictionaries({
        "fields": st.lists(extracted_field_strategy, min_size=1, max_size=10),
        "input_tokens": token_count_strategy,
        "output_tokens": token_count_strategy,
    })


# ---------------------------------------------------------------------------
# Feature: document-processing-pipeline, Property 7: Bedrock response parsing
# extracts fields and token counts
# ---------------------------------------------------------------------------


@given(data=bedrock_response_strategy())
@settings(max_examples=200)
def test_property7_fields_and_token_counts_extracted(data: dict) -> None:
    """For any valid Bedrock response JSON with 1-10 fields and token counts,
    ``_parse_response`` must return an ``ExtractionResult`` where every field
    is present with correct values and token counts match the response metadata.

    Validates: Requirements 4.5, 4.6
    """
    fields_json = data["fields"]
    input_tokens = data["input_tokens"]
    output_tokens = data["output_tokens"]

    # Build a Bedrock-shaped response body
    response_body = {
        "content": [
            {"text": json.dumps({"fields": fields_json})}
        ],
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        },
    }

    result = LLMReasoningService._parse_response(response_body)

    # Must be an ExtractionResult
    assert isinstance(result, ExtractionResult)

    # Token counts must match
    assert result.input_tokens == input_tokens
    assert result.output_tokens == output_tokens

    # Field count must match
    assert len(result.fields) == len(fields_json)

    # Each field must have the correct name, value, and confidence
    for expected, actual in zip(fields_json, result.fields):
        assert isinstance(actual, ExtractedField)
        assert actual.field_name == expected["field_name"]
        assert actual.value == expected["value"]
        assert abs(actual.confidence - expected["confidence"]) < 1e-9


@given(data=bedrock_response_strategy())
@settings(max_examples=200)
def test_property7_token_counts_are_non_negative(data: dict) -> None:
    """Token counts on the parsed result must be non-negative integers."""
    response_body = {
        "content": [
            {"text": json.dumps({"fields": data["fields"]})}
        ],
        "usage": {
            "input_tokens": data["input_tokens"],
            "output_tokens": data["output_tokens"],
        },
    }

    result = LLMReasoningService._parse_response(response_body)

    assert result.input_tokens >= 0
    assert result.output_tokens >= 0

# ---------------------------------------------------------------------------
# Feature: document-processing-pipeline, Property 8: Invalid LLM JSON raises
# parsing exception with raw output
# ---------------------------------------------------------------------------

# Strategies for generating invalid LLM responses

# Completely non-JSON strings (random text, binary-ish, special chars)
non_json_text_strategy = st.text(min_size=1, max_size=500).filter(
    lambda t: _is_not_valid_json_with_fields(t)
)

# Malformed JSON: valid JSON but missing the required "fields" key
malformed_json_no_fields_strategy = st.fixed_dictionaries({
    "data": st.text(min_size=0, max_size=100),
}).map(json.dumps)

# Valid JSON with "fields" that is not a list
malformed_json_fields_not_list_strategy = st.fixed_dictionaries({
    "fields": st.one_of(
        st.text(min_size=0, max_size=50),
        st.integers(),
        st.none(),
        st.fixed_dictionaries({"a": st.text(max_size=10)}),
    ),
}).map(json.dumps)

# Valid JSON with "fields" list but items missing required keys
_partial_field = st.fixed_dictionaries({
    "field_name": field_name_strategy,
    # deliberately omit "value" and/or "confidence"
})

malformed_json_incomplete_fields_strategy = st.fixed_dictionaries({
    "fields": st.lists(_partial_field, min_size=1, max_size=5),
}).map(json.dumps)


def _is_not_valid_json_with_fields(text: str) -> bool:
    """Return True if *text* is NOT valid JSON containing a 'fields' list of
    well-formed extraction objects."""
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return True  # not JSON at all — good
    if not isinstance(parsed, dict) or "fields" not in parsed:
        return True
    fields = parsed["fields"]
    if not isinstance(fields, list):
        return True
    for item in fields:
        if (
            not isinstance(item, dict)
            or "field_name" not in item
            or "value" not in item
            or "confidence" not in item
        ):
            return True
    return False


def _wrap_in_bedrock_response(raw_text: str) -> dict:
    """Wrap raw text in a Bedrock-shaped response body."""
    return {
        "content": [{"text": raw_text}],
        "usage": {"input_tokens": 10, "output_tokens": 5},
    }


@given(raw_text=non_json_text_strategy)
@settings(max_examples=200)
def test_property8_non_json_raises_parsing_error(raw_text: str) -> None:
    """For any non-JSON string returned by the LLM, ``_parse_response`` must
    raise ``LLMParsingError`` whose message contains the raw output text
    (truncated to 500 chars).

    Validates: Requirements 4.8
    """
    response_body = _wrap_in_bedrock_response(raw_text)

    with pytest.raises(LLMParsingError) as exc_info:
        LLMReasoningService._parse_response(response_body)

    # The raw_output attribute must be set
    assert exc_info.value.raw_output == raw_text
    # The message must contain the raw output (truncated to 500 chars)
    assert raw_text[:500] in str(exc_info.value)


@given(raw_text=malformed_json_no_fields_strategy)
@settings(max_examples=200)
def test_property8_json_missing_fields_key_raises_parsing_error(raw_text: str) -> None:
    """For any valid JSON that lacks the 'fields' key, ``_parse_response``
    must raise ``LLMParsingError`` with the raw output.

    Validates: Requirements 4.8
    """
    response_body = _wrap_in_bedrock_response(raw_text)

    with pytest.raises(LLMParsingError) as exc_info:
        LLMReasoningService._parse_response(response_body)

    assert exc_info.value.raw_output == raw_text
    assert raw_text[:500] in str(exc_info.value)


@given(raw_text=malformed_json_fields_not_list_strategy)
@settings(max_examples=200)
def test_property8_fields_not_list_raises_parsing_error(raw_text: str) -> None:
    """For any JSON where 'fields' is not a list, ``_parse_response`` must
    raise ``LLMParsingError`` with the raw output.

    Validates: Requirements 4.8
    """
    response_body = _wrap_in_bedrock_response(raw_text)

    with pytest.raises(LLMParsingError) as exc_info:
        LLMReasoningService._parse_response(response_body)

    assert exc_info.value.raw_output == raw_text
    assert raw_text[:500] in str(exc_info.value)


@given(raw_text=malformed_json_incomplete_fields_strategy)
@settings(max_examples=200)
def test_property8_incomplete_field_objects_raises_parsing_error(raw_text: str) -> None:
    """For any JSON where field objects are missing required keys (value,
    confidence), ``_parse_response`` must raise ``LLMParsingError``.

    Validates: Requirements 4.8
    """
    response_body = _wrap_in_bedrock_response(raw_text)

    with pytest.raises(LLMParsingError) as exc_info:
        LLMReasoningService._parse_response(response_body)

    assert exc_info.value.raw_output == raw_text
    assert raw_text[:500] in str(exc_info.value)


def test_property8_empty_content_raises_parsing_error() -> None:
    """Edge case: empty content array must raise ``LLMParsingError``."""
    response_body = {
        "content": [],
        "usage": {"input_tokens": 0, "output_tokens": 0},
    }

    with pytest.raises(LLMParsingError) as exc_info:
        LLMReasoningService._parse_response(response_body)

    assert exc_info.value.raw_output == ""


# ---------------------------------------------------------------------------
# Unit tests for LLM Reasoning Service (Task 3.5)
# Requirements: 4.4, 4.7
# ---------------------------------------------------------------------------


class TestLLMReasoningServiceUnit:
    """Unit tests for LLMReasoningService covering env var config, successful
    extraction with mocked Bedrock, and API error handling."""

    def test_model_id_from_env_var(self, monkeypatch):
        """Constructor reads BEDROCK_MODEL_ID from environment when no
        explicit model_id is provided.

        Requirement 4.4: Read model ID from BEDROCK_MODEL_ID env var.
        """
        monkeypatch.setenv("BEDROCK_MODEL_ID", "anthropic.claude-3-haiku-20240307-v1:0")
        svc = LLMReasoningService()
        assert svc.model_id == "anthropic.claude-3-haiku-20240307-v1:0"

    def test_explicit_model_id_overrides_env_var(self, monkeypatch):
        """An explicit model_id parameter takes precedence over the env var."""
        monkeypatch.setenv("BEDROCK_MODEL_ID", "env-model-id")
        svc = LLMReasoningService(model_id="explicit-model-id")
        assert svc.model_id == "explicit-model-id"

    def test_successful_field_extraction(self, monkeypatch):
        """extract_fields returns an ExtractionResult with correct fields and
        token counts when Bedrock returns a valid response.

        Requirements: 4.4, 4.5, 4.6
        """
        bedrock_response_body = json.dumps({
            "content": [
                {
                    "text": json.dumps({
                        "fields": [
                            {"field_name": "invoice_number", "value": "INV-001", "confidence": 0.95},
                            {"field_name": "total_amount", "value": 1234.56, "confidence": 0.88},
                        ]
                    })
                }
            ],
            "usage": {
                "input_tokens": 150,
                "output_tokens": 42,
            },
        })

        class FakeStreamingBody:
            def read(self):
                return bedrock_response_body.encode()

        captured = {}

        def fake_invoke_model(**kwargs):
            captured.update(kwargs)
            return {"body": FakeStreamingBody()}

        svc = LLMReasoningService(model_id="test-model", region="us-east-1")
        monkeypatch.setattr(svc.client, "invoke_model", fake_invoke_model)

        schema = {
            "fields": [
                {"name": "invoice_number", "type": "string", "description": "The invoice number"},
                {"name": "total_amount", "type": "number", "description": "Total amount"},
            ]
        }
        result = svc.extract_fields("Some parsed document text", schema)

        # Verify the result type and field count
        assert isinstance(result, ExtractionResult)
        assert len(result.fields) == 2

        # Verify field values
        assert result.fields[0].field_name == "invoice_number"
        assert result.fields[0].value == "INV-001"
        assert result.fields[0].confidence == 0.95

        assert result.fields[1].field_name == "total_amount"
        assert result.fields[1].value == 1234.56
        assert result.fields[1].confidence == 0.88

        # Verify token counts
        assert result.input_tokens == 150
        assert result.output_tokens == 42

        # Verify the correct model ID was passed to Bedrock
        assert captured["modelId"] == "test-model"

    def test_bedrock_api_error_raises_llm_error(self, monkeypatch):
        """ClientError from Bedrock is translated to LLMError with error type
        and message.

        Requirement 4.7: Raise exception on Bedrock API errors.
        """
        from botocore.exceptions import ClientError
        from services.exceptions import LLMError

        def fake_invoke_model(**kwargs):
            raise ClientError(
                error_response={
                    "Error": {
                        "Code": "ThrottlingException",
                        "Message": "Rate exceeded",
                    }
                },
                operation_name="InvokeModel",
            )

        svc = LLMReasoningService(model_id="test-model", region="us-east-1")
        monkeypatch.setattr(svc.client, "invoke_model", fake_invoke_model)

        with pytest.raises(LLMError) as exc_info:
            svc.extract_fields("text", {"fields": []})

        err = exc_info.value
        assert err.error_type == "ThrottlingException"
        assert err.message == "Rate exceeded"
        assert "ThrottlingException" in str(err)
        assert "Rate exceeded" in str(err)

    def test_bedrock_access_denied_raises_llm_error(self, monkeypatch):
        """AccessDeniedException from Bedrock is surfaced as LLMError."""
        from botocore.exceptions import ClientError
        from services.exceptions import LLMError

        def fake_invoke_model(**kwargs):
            raise ClientError(
                error_response={
                    "Error": {
                        "Code": "AccessDeniedException",
                        "Message": "User is not authorized to perform bedrock:InvokeModel",
                    }
                },
                operation_name="InvokeModel",
            )

        svc = LLMReasoningService(model_id="test-model", region="us-east-1")
        monkeypatch.setattr(svc.client, "invoke_model", fake_invoke_model)

        with pytest.raises(LLMError) as exc_info:
            svc.extract_fields("text", {"fields": []})

        assert exc_info.value.error_type == "AccessDeniedException"
