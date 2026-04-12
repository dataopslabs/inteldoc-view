"""Reconciliation Agent — wraps the dual-pipeline reconciliation logic as a Strands tool."""
from __future__ import annotations

from strands import Agent, tool

from services.workflow.agents import _get_model_provider


@tool
def reconcile_fields(
    primary_fields: dict,
    secondary_fields: dict,
    hitl_threshold: float,
) -> dict:
    """Compare two extraction outputs and produce reconciled results.

    For each field key present in either dict:
    - Both have the same value → confidence 1.0, no conflict.
    - Both have different values → confidence 0.5, flag as conflict, use primary value.
    - Only one has a value → confidence 0.7, use available value.

    Overall confidence is the average of per-field confidences.

    Args:
        primary_fields: Fields from the primary extraction run.
        secondary_fields: Fields from the secondary extraction run.
        hitl_threshold: Confidence threshold below which HITL review is triggered.

    Returns:
        Dict with:
        - ``fields``: list of dicts with field_name, value, confidence, conflict.
        - ``confidence``: overall confidence (float).
        - ``conflicts``: list of field names that had conflicts.
    """
    all_keys = sorted(set(list(primary_fields.keys()) + list(secondary_fields.keys())))

    field_results: list[dict] = []
    conflicts: list[str] = []

    for key in all_keys:
        in_primary = key in primary_fields
        in_secondary = key in secondary_fields

        if in_primary and in_secondary:
            if primary_fields[key] == secondary_fields[key]:
                # Both agree
                field_results.append({
                    "field_name": key,
                    "value": primary_fields[key],
                    "confidence": 1.0,
                    "conflict": False,
                })
            else:
                # Both disagree — use primary value, reduced confidence
                field_results.append({
                    "field_name": key,
                    "value": primary_fields[key],
                    "confidence": 0.5,
                    "conflict": True,
                })
                conflicts.append(key)
        elif in_primary:
            # Only primary has a value
            field_results.append({
                "field_name": key,
                "value": primary_fields[key],
                "confidence": 0.7,
                "conflict": False,
            })
        else:
            # Only secondary has a value
            field_results.append({
                "field_name": key,
                "value": secondary_fields[key],
                "confidence": 0.7,
                "conflict": False,
            })

    if field_results:
        overall_confidence = sum(f["confidence"] for f in field_results) / len(field_results)
    else:
        overall_confidence = 1.0

    return {
        "fields": field_results,
        "confidence": overall_confidence,
        "conflicts": conflicts,
    }


def create_reconciliation_agent(
    system_prompt: str, model_id: str | None = None
) -> Agent:
    """Create a Reconciliation Agent with the dual-pipeline comparison tool.

    Parameters
    ----------
    system_prompt:
        The system prompt describing reconciliation responsibilities.
    model_id:
        Optional Bedrock model identifier override.

    Returns
    -------
    Agent
        A Strands Agent configured with the ``reconcile_fields`` tool.
    """
    return Agent(
        system_prompt=system_prompt,
        tools=[reconcile_fields],
        model=_get_model_provider(model_id),
    )
