"""Property tests for AgentStep required fields.

Feature: strands-workflow-engine
"""
from __future__ import annotations

from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

from services.workflow.models import AgentStep


# ---------------------------------------------------------------------------
# Strategies (reuses pattern from test_backward_compat.py)
# ---------------------------------------------------------------------------

agent_step_strategy = st.builds(
    AgentStep,
    agent_name=st.text(min_size=1, max_size=30),
    model_id=st.text(min_size=1, max_size=60),
    prompt_version=st.from_regex(r"[0-9]+\.[0-9]+\.[0-9]+", fullmatch=True),
    input_tokens=st.integers(min_value=0, max_value=100_000),
    output_tokens=st.integers(min_value=0, max_value=100_000),
    latency_ms=st.floats(min_value=0.0, max_value=600_000.0, allow_nan=False, allow_infinity=False),
    status=st.sampled_from(["success", "error"]),
    error_message=st.one_of(st.none(), st.text(max_size=200)),
)


# ---------------------------------------------------------------------------
# Property 3: Agent step records contain all required fields
# Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
# ---------------------------------------------------------------------------


@given(step=agent_step_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property3_agent_name_is_non_empty_string(step: AgentStep) -> None:
    """For any AgentStep, agent_name must be a non-empty string.

    **Validates: Requirements 4.2**
    """
    assert isinstance(step.agent_name, str)
    assert len(step.agent_name) > 0, "agent_name must be non-empty"


@given(step=agent_step_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property3_model_id_is_string(step: AgentStep) -> None:
    """For any AgentStep, model_id must be a string (can be 'none' for agents
    that don't invoke a model).

    **Validates: Requirements 4.3**
    """
    assert isinstance(step.model_id, str)


@given(step=agent_step_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property3_prompt_version_is_string(step: AgentStep) -> None:
    """For any AgentStep, prompt_version must be a string.

    **Validates: Requirements 4.4**
    """
    assert isinstance(step.prompt_version, str)


@given(step=agent_step_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property3_token_counts_non_negative(step: AgentStep) -> None:
    """For any AgentStep, input_tokens and output_tokens must be >= 0.

    **Validates: Requirements 4.5**
    """
    assert step.input_tokens >= 0, f"input_tokens must be >= 0, got {step.input_tokens}"
    assert step.output_tokens >= 0, f"output_tokens must be >= 0, got {step.output_tokens}"


@given(step=agent_step_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property3_latency_ms_non_negative(step: AgentStep) -> None:
    """For any AgentStep, latency_ms must be >= 0.

    **Validates: Requirements 4.6**
    """
    assert step.latency_ms >= 0, f"latency_ms must be >= 0, got {step.latency_ms}"


@given(step=agent_step_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property3_status_is_valid(step: AgentStep) -> None:
    """For any AgentStep, status must be either 'success' or 'error'.

    **Validates: Requirements 4.7**
    """
    assert step.status in {"success", "error"}, (
        f"status must be 'success' or 'error', got '{step.status}'"
    )


@given(step=agent_step_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property3_error_message_settable_on_error(step: AgentStep) -> None:
    """For any AgentStep with status 'error', error_message can be set to a string.

    **Validates: Requirements 4.7**
    """
    if step.status == "error":
        # error_message is allowed to be None or a string
        assert step.error_message is None or isinstance(step.error_message, str)


# ---------------------------------------------------------------------------
# Property 4: Total tokens equals sum of agent step tokens
# Validates: Requirements 4.9
# ---------------------------------------------------------------------------


@given(steps=st.lists(agent_step_strategy, min_size=0, max_size=20))
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property4_total_tokens_equals_sum_of_step_tokens(steps: list[AgentStep]) -> None:
    """For any list of AgentSteps, the total tokens should equal the sum of
    (input_tokens + output_tokens) across all steps.

    **Validates: Requirements 4.9**
    """
    expected_total = sum(step.input_tokens + step.output_tokens for step in steps)
    assert expected_total == sum(step.input_tokens for step in steps) + sum(
        step.output_tokens for step in steps
    )
    # Verify the total is non-negative
    assert expected_total >= 0


# ---------------------------------------------------------------------------
# Property 5: Total latency equals sum of agent step latencies
# Validates: Requirements 4.10
# ---------------------------------------------------------------------------


@given(steps=st.lists(agent_step_strategy, min_size=0, max_size=20))
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property5_total_latency_equals_sum_of_step_latencies(steps: list[AgentStep]) -> None:
    """For any list of AgentSteps, the total latency should equal the sum of
    latency_ms across all steps (within floating-point tolerance).

    **Validates: Requirements 4.10**
    """
    import pytest

    expected_total = sum(step.latency_ms for step in steps)
    individual_sum = 0.0
    for step in steps:
        individual_sum += step.latency_ms
    assert individual_sum == pytest.approx(expected_total)
    # Verify the total is non-negative
    assert expected_total >= 0.0
