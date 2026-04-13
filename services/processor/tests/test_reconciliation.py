"""G5-03: Unit tests for reconciliation module."""
from __future__ import annotations

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from reconciliation import reconcile


class TestReconcile:
    def test_empty_inputs_forces_hitl(self):
        """Reconciling empty fields should force HITL — no data was extracted."""
        result = reconcile({}, {}, hitl_threshold=0.8)
        assert result.hitl_required is True
        assert result.overall_confidence == 0.0
        assert result.fields == []

    def test_llm_only_fields_no_conflict(self):
        """Fields from LLM only (no docling) should pass through; threshold below 0.7 means no HITL."""
        llm = {"invoice_number": "INV-001", "amount": "500.00"}
        result = reconcile({}, llm, hitl_threshold=0.5)
        assert result.hitl_required is False
        field_names = {f.field for f in result.fields}
        assert "invoice_number" in field_names
        assert "amount" in field_names

    def test_docling_only_fields(self):
        """Fields from docling only should pass through; threshold below 0.7 means no HITL."""
        docling = {"date": "2024-01-15"}
        result = reconcile(docling, {}, hitl_threshold=0.5)
        assert result.hitl_required is False
        field_names = {f.field for f in result.fields}
        assert "date" in field_names

    def test_agreement_raises_confidence(self):
        """Fields that agree between docling and LLM should have high confidence."""
        docling = {"amount": "500.00"}
        llm = {"amount": "500.00"}
        result = reconcile(docling, llm, hitl_threshold=0.8)
        amount_field = next((f for f in result.fields if f.field == "amount"), None)
        assert amount_field is not None
        assert amount_field.conflict is False
        assert amount_field.confidence >= 0.9

    def test_conflict_lowers_confidence(self):
        """Fields that disagree should be flagged as conflicting."""
        docling = {"amount": "500.00"}
        llm = {"amount": "600.00"}
        result = reconcile(docling, llm, hitl_threshold=0.8)
        amount_field = next((f for f in result.fields if f.field == "amount"), None)
        assert amount_field is not None
        assert amount_field.conflict is True
        assert amount_field.confidence < 1.0

    def test_hitl_required_when_confidence_below_threshold(self):
        """Low-confidence results should trigger HITL."""
        docling = {"amount": "100"}
        llm = {"amount": "999"}
        result = reconcile(docling, llm, hitl_threshold=0.99)  # Very high threshold
        assert result.hitl_required is True

    def test_no_hitl_when_confidence_above_threshold(self):
        """High-confidence results (agreement) should not trigger HITL."""
        docling = {"amount": "500"}
        llm = {"amount": "500"}
        result = reconcile(docling, llm, hitl_threshold=0.5)
        assert result.hitl_required is False
