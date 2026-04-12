"""Property and unit tests for confidence scoring and status determination.

Feature: document-processing-pipeline
"""
from __future__ import annotations

import math

import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

from services.models import ExtractedField
from services.processor import compute_confidence, determine_status


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

confidence_value_strategy = st.floats(min_value=0.0, max_value=1.0, allow_nan=False)

extracted_field_strategy = st.builds(
    ExtractedField,
    field_name=st.text(min_size=1, max_size=30),
    value=st.text(max_size=50),
    confidence=confidence_value_strategy,
)

extracted_fields_list_strategy = st.lists(
    extracted_field_strategy,
    min_size=1,
    max_size=50,
)


# ---------------------------------------------------------------------------
# Feature: document-processing-pipeline, Property 1: Confidence score is the
# arithmetic mean of per-field scores
# ---------------------------------------------------------------------------


@given(fields=extracted_fields_list_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property1_confidence_is_arithmetic_mean(fields: list[ExtractedField]) -> None:
    """For any non-empty list of ExtractedField objects with confidence values
    in [0.0, 1.0], the computed overall confidence must equal the arithmetic
    mean of all per-field confidence scores within floating-point tolerance.
    """
    result = compute_confidence(fields)
    expected = sum(f.confidence for f in fields) / len(fields)

    assert math.isclose(result, expected, rel_tol=1e-9), (
        f"Expected confidence {expected}, got {result}"
    )


@given(fields=extracted_fields_list_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property1_confidence_within_bounds(fields: list[ExtractedField]) -> None:
    """The computed confidence must always be in [0.0, 1.0] since all
    per-field scores are in that range."""
    result = compute_confidence(fields)

    assert 0.0 <= result <= 1.0, (
        f"Confidence {result} is outside [0.0, 1.0]"
    )


def test_empty_fields_returns_one() -> None:
    """An empty field list should yield confidence 1.0 (Requirement 5.5)."""
    assert compute_confidence([]) == 1.0


# ---------------------------------------------------------------------------
# Feature: document-processing-pipeline, Property 2: Status determination
# follows confidence-threshold comparison
# ---------------------------------------------------------------------------


@given(
    confidence=confidence_value_strategy,
    threshold=confidence_value_strategy,
)
@settings(max_examples=200)
def test_property2_status_determination(confidence: float, threshold: float) -> None:
    """For any (confidence, threshold) pair in [0.0, 1.0], determine_status
    must return 'completed' when confidence >= threshold and 'hitl_required'
    when confidence < threshold.

    Validates: Requirements 1.6, 1.7, 5.2, 5.3
    """
    result = determine_status(confidence, threshold)

    if confidence >= threshold:
        assert result == "completed", (
            f"Expected 'completed' for confidence={confidence} >= threshold={threshold}, got '{result}'"
        )
    else:
        assert result == "hitl_required", (
            f"Expected 'hitl_required' for confidence={confidence} < threshold={threshold}, got '{result}'"
        )
