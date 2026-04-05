"""
Validation service — Phase 3.

Validates reconciled field output against the workspace schema.
Checks type coercion, required fields, and value constraints.
"""
from __future__ import annotations

from typing import Any
from dataclasses import dataclass, field


@dataclass
class ValidationError:
    field: str
    message: str


@dataclass
class ValidationResult:
    valid: bool
    errors: list[ValidationError] = field(default_factory=list)
    coerced_fields: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


# Schema field descriptor supported types
SUPPORTED_TYPES = {"string", "number", "integer", "boolean", "date", "any"}


def validate_output(
    extracted: dict[str, Any],
    schema: dict[str, Any],
) -> ValidationResult:
    """
    Validate extracted fields against workspace schema.

    Schema format:
    {
      "field_name": {
        "type": "string" | "number" | "integer" | "boolean" | "date" | "any",
        "required": true | false,
        "description": "...",
      },
      ...
    }

    Simple schema (field_name → type string) is also supported:
    { "invoice_number": "string", "amount": "number" }
    """
    if not schema:
        return ValidationResult(valid=True, warnings=["No schema defined — skipping validation"])

    errors: list[ValidationError] = []
    coerced: dict[str, Any] = {}
    warnings: list[str] = []

    # Normalise schema to { field: { type, required } }
    normalised = _normalise_schema(schema)

    for fname, descriptor in normalised.items():
        expected_type = descriptor.get("type", "any")
        required = descriptor.get("required", False)
        raw_value = extracted.get(fname)

        # Required check
        if required and (raw_value is None or raw_value == ""):
            errors.append(ValidationError(field=fname, message="Required field is missing or empty"))
            continue

        if raw_value is None:
            continue  # optional and absent — fine

        # Type coercion
        coerced_value, err = _coerce(fname, raw_value, expected_type)
        if err:
            errors.append(err)
        elif coerced_value != raw_value:
            coerced[fname] = coerced_value
            warnings.append(f"Field '{fname}' coerced from {type(raw_value).__name__} to {expected_type}")

    # Warn on extra fields not in schema
    for fname in extracted:
        if fname not in normalised:
            warnings.append(f"Field '{fname}' not in schema — included as-is")

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        coerced_fields=coerced,
        warnings=warnings,
    )


def _normalise_schema(schema: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Accept both {"field": "type"} and {"field": {"type": "...", "required": ...}} formats."""
    result: dict[str, dict[str, Any]] = {}
    for k, v in schema.items():
        if isinstance(v, str):
            result[k] = {"type": v, "required": False}
        elif isinstance(v, dict):
            result[k] = v
        else:
            result[k] = {"type": "any", "required": False}
    return result


def _coerce(fname: str, value: Any, expected_type: str) -> tuple[Any, ValidationError | None]:
    """Try to coerce value to expected_type. Returns (coerced_value, error_or_None)."""
    if expected_type == "any":
        return value, None

    try:
        if expected_type == "string":
            return str(value), None
        if expected_type == "number":
            return float(str(value).replace(",", "").strip()), None
        if expected_type == "integer":
            return int(float(str(value).replace(",", "").strip())), None
        if expected_type == "boolean":
            if isinstance(value, bool):
                return value, None
            sv = str(value).lower().strip()
            if sv in ("true", "yes", "1"):
                return True, None
            if sv in ("false", "no", "0"):
                return False, None
            return value, ValidationError(field=fname, message=f"Cannot coerce '{value}' to boolean")
        if expected_type == "date":
            # Accept ISO strings or common date formats — just validate it looks date-like
            sv = str(value).strip()
            if len(sv) >= 8 and any(c.isdigit() for c in sv):
                return sv, None
            return value, ValidationError(field=fname, message=f"Value '{value}' does not look like a date")
    except (ValueError, TypeError) as e:
        return value, ValidationError(field=fname, message=f"Type coercion to {expected_type} failed: {e}")

    return value, None
