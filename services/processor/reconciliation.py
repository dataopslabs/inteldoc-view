"""Dual-pipeline reconciliation engine — field-level confidence scoring."""
from __future__ import annotations

from typing import Any
from .models import FieldResult, ReconciliationResult

CONFLICT_PENALTY = 0.3
BASE_CONFIDENCE = 1.0


def reconcile(
    docling_fields: dict[str, Any],
    llm_fields: dict[str, Any],
    hitl_threshold: float = 0.8,
) -> ReconciliationResult:
    """
    Compare Docling and LLM outputs field-by-field.

    Confidence rules:
    - Both agree        → confidence = 1.0, use shared value
    - Values differ     → confidence -= 0.3, flag as conflict, prefer LLM value
    - Only one present  → confidence = 0.7, use available value
    - Both missing      → confidence = 0.0, null value
    """
    all_keys = set(docling_fields.keys()) | set(llm_fields.keys())
    results: list[FieldResult] = []

    for key in sorted(all_keys):
        dv = docling_fields.get(key)
        lv = llm_fields.get(key)
        confidence = BASE_CONFIDENCE
        conflict = False
        final_value: Any = None

        if dv is not None and lv is not None:
            if _values_equal(dv, lv):
                final_value = lv
                confidence = 1.0
            else:
                final_value = lv  # prefer LLM when conflict
                confidence = BASE_CONFIDENCE - CONFLICT_PENALTY
                conflict = True
        elif lv is not None:
            final_value = lv
            confidence = 0.7
        elif dv is not None:
            final_value = dv
            confidence = 0.7
        else:
            final_value = None
            confidence = 0.0

        results.append(
            FieldResult(
                field=key,
                docling_value=dv,
                llm_value=lv,
                final_value=final_value,
                confidence=round(confidence, 3),
                conflict=conflict,
            )
        )

    overall = _compute_overall_confidence(results)
    return ReconciliationResult(
        fields=results,
        overall_confidence=round(overall, 3),
        hitl_required=overall < hitl_threshold,
    )


def _values_equal(a: Any, b: Any) -> bool:
    """Normalised equality — strips whitespace for strings, tolerates minor float drift."""
    if isinstance(a, str) and isinstance(b, str):
        return a.strip().lower() == b.strip().lower()
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) < 0.01
    return a == b


def _compute_overall_confidence(fields: list[FieldResult]) -> float:
    if not fields:
        return 0.0
    return sum(f.confidence for f in fields) / len(fields)
