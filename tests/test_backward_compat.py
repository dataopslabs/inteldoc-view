"""Property tests for WorkflowResult Phase 2 backward compatibility.

Feature: strands-workflow-engine
"""
from __future__ import annotations

from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

from services.workflow.models import AgentStep, WorkflowResult


# ---------------------------------------------------------------------------
# Strategies
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

workflow_result_strategy = st.builds(
    WorkflowResult,
    trace_id=st.uuids().map(str),
    workspace_id=st.uuids().map(str),
    status=st.sampled_from(["completed", "hitl_required", "failed"]),
    workflow_state=st.text(min_size=1, max_size=30),
    confidence=st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
    tokens=st.integers(min_value=0, max_value=1_000_000),
    latency_ms=st.floats(min_value=0.0, max_value=600_000.0, allow_nan=False, allow_infinity=False),
    fields=st.lists(st.fixed_dictionaries({"field_name": st.text(min_size=1, max_size=20), "value": st.text(max_size=50)}), max_size=10),
    agent_steps=st.lists(agent_step_strategy, max_size=5),
    validation_errors=st.lists(st.fixed_dictionaries({"error": st.text(max_size=100)}), max_size=5),
    error=st.one_of(st.none(), st.text(max_size=200)),
)


# ---------------------------------------------------------------------------
# Property 11: Workflow result maintains backward compatibility with Phase 2
# Validates: Requirements 6.4
# ---------------------------------------------------------------------------

REQUIRED_KEYS = {
    "trace_id",
    "workspace_id",
    "status",
    "workflow_state",
    "confidence",
    "tokens",
    "latency_ms",
    "fields",
    "agent_steps",
    "validation_errors",
}

VALID_STATUSES = {"completed", "hitl_required", "failed"}


@given(result=workflow_result_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property11_api_response_contains_all_required_keys(result: WorkflowResult) -> None:
    """For any WorkflowResult, to_api_response() must return a dict containing
    all required Phase 2 keys: trace_id, workspace_id, status, workflow_state,
    confidence, tokens, latency_ms, fields, agent_steps, validation_errors.

    **Validates: Requirements 6.4**
    """
    response = result.to_api_response()

    assert isinstance(response, dict)
    missing = REQUIRED_KEYS - response.keys()
    assert not missing, f"Missing required keys in API response: {missing}"


@given(result=workflow_result_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property11_status_is_valid(result: WorkflowResult) -> None:
    """For any WorkflowResult, the status in to_api_response() must be one of
    'completed', 'hitl_required', or 'failed'.

    **Validates: Requirements 6.4**
    """
    response = result.to_api_response()

    assert response["status"] in VALID_STATUSES, (
        f"Invalid status '{response['status']}', expected one of {VALID_STATUSES}"
    )


@given(result=workflow_result_strategy)
@settings(max_examples=200, suppress_health_check=[HealthCheck.too_slow])
def test_property11_agent_steps_are_serialized_dicts(result: WorkflowResult) -> None:
    """For any WorkflowResult, agent_steps in to_api_response() must be a list
    of plain dicts (not AgentStep objects), ensuring JSON serialisability.

    **Validates: Requirements 6.4**
    """
    response = result.to_api_response()

    assert isinstance(response["agent_steps"], list)
    for step in response["agent_steps"]:
        assert isinstance(step, dict), (
            f"agent_steps entry should be a dict, got {type(step).__name__}"
        )
        assert not isinstance(step, AgentStep), (
            "agent_steps should contain plain dicts, not AgentStep instances"
        )
