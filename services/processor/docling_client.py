"""Docling API client — calls the Docling ECS service (docling-serve).

API contract (from /openapi.json):
  POST /v1/convert/file
    multipart: files=(<filename>, <bytes>, <mime>)
  Response:
    {
      "status": "success" | "skipped" | "failure",
      "document": {
        "filename": str,
        "md_content": str | null,   # Markdown — primary output
        "text_content": str | null, # Plain text fallback
        "json_content": ... | null,
        "html_content": str | null,
      },
      "processing_time": float,
      "errors": [...],
    }
"""
from __future__ import annotations

import os
import httpx
from typing import Any

# T4-22: tenacity for exponential backoff retry on transient Docling HTTP errors
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential_jitter,
    retry_if_exception_type,
    before_sleep_log,
)
import logging

logger = logging.getLogger(__name__)


DOCLING_SERVICE_URL = os.environ.get("DOCLING_SERVICE_URL", "")
TIMEOUT = 120.0   # PDF conversion can take a while

# T4-22: Retry configuration — 3 attempts total with exponential backoff + jitter.
# Only retry on transient errors (timeout, network errors, 5xx HTTP errors).
# Non-retryable errors (4xx, bad config) raise DoclingError immediately.
_MAX_RETRY_ATTEMPTS = 3
_RETRY_INITIAL_WAIT_S = 1.0   # initial wait: 1s
_RETRY_MAX_WAIT_S = 30.0      # max wait per retry: 30s
_RETRY_JITTER_S = 2.0         # random jitter: 0–2s


class DoclingError(Exception):
    pass


class _DoclingTransientError(Exception):
    """Internal exception used to trigger tenacity retries on transient failures."""
    pass


@retry(
    retry=retry_if_exception_type(_DoclingTransientError),
    stop=stop_after_attempt(_MAX_RETRY_ATTEMPTS),
    wait=wait_exponential_jitter(
        initial=_RETRY_INITIAL_WAIT_S,
        max=_RETRY_MAX_WAIT_S,
        jitter=_RETRY_JITTER_S,
    ),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=False,
)
def _call_docling_with_retry(url: str, file_bytes: bytes, filename: str) -> dict[str, Any]:
    """
    Make the HTTP call to Docling with automatic retry on transient errors.
    Raises _DoclingTransientError for tenacity to retry; DoclingError for permanent failures.
    """
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(
                url,
                files={"files": (filename, file_bytes, _mime_type(filename))},
            )
            response.raise_for_status()
    except httpx.TimeoutException as e:
        # Transient: ECS pod may be under load — retry
        raise _DoclingTransientError(f"Docling request timed out after {TIMEOUT}s: {e}") from e
    except httpx.HTTPStatusError as e:
        status_code = e.response.status_code
        if status_code >= 500:
            # Transient: Docling service error (5xx) — retry
            raise _DoclingTransientError(
                f"Docling returned HTTP {status_code} (transient): {e.response.text[:200]}"
            ) from e
        # Permanent: 4xx client errors — don't retry
        raise DoclingError(
            f"Docling returned HTTP {status_code}: {e.response.text[:500]}"
        ) from e
    except httpx.RequestError as e:
        # Transient: DNS failure, connection reset — retry
        raise _DoclingTransientError(f"Docling request failed (transient): {e}") from e

    return response.json()


def parse_document(file_bytes: bytes, filename: str) -> dict[str, Any]:
    """
    Submit a document to the Docling ECS service and return structured output.

    Calls POST /v1/convert/file (docling-serve native API).
    T4-22: HTTP call is wrapped with exponential-backoff retry (up to 3 attempts)
    for transient errors (timeouts, 5xx, connection resets).

    Returns:
        {
          "markdown": str,   # md_content from Docling (preferred)
          "fields": {},      # always empty dict — field extraction done by LLM
          "metadata": {      # processing metadata
              "status": str,
              "processing_time": float,
              "filename": str,
          },
        }

    Raises:
        DoclingError: on HTTP errors, timeout exhaustion, or Docling status != success.
    """
    if not DOCLING_SERVICE_URL:
        raise DoclingError("DOCLING_SERVICE_URL is not configured")

    url = f"{DOCLING_SERVICE_URL.rstrip('/')}/v1/convert/file"

    try:
        data = _call_docling_with_retry(url, file_bytes, filename)
    except _DoclingTransientError as e:
        # All retries exhausted — promote to permanent DoclingError
        raise DoclingError(
            f"Docling request failed after {_MAX_RETRY_ATTEMPTS} attempts: {e}"
        ) from e

    status = data.get("status", "unknown")

    if status not in ("success", "skipped"):
        errors = data.get("errors", [])
        raise DoclingError(
            f"Docling conversion status={status!r}: {errors}"
        )

    doc = data.get("document") or {}
    # Prefer markdown, fall back to text_content, then empty string
    markdown: str = doc.get("md_content") or doc.get("text_content") or ""

    # G6-23: Extract structured table data from Docling JSON output.
    # Docling's json_content contains a 'tables' array when the document has tables.
    tables: list[dict] = _extract_tables(doc)

    return {
        "markdown": markdown,
        "fields": {},
        "tables": tables,          # G6-23: structured table data for LLM extraction
        "metadata": {
            "status": status,
            "processing_time": data.get("processing_time", 0.0),
            "filename": doc.get("filename", filename),
            "table_count": len(tables),
        },
    }


def _extract_tables(doc: dict) -> list[dict]:
    """
    G6-23: Extract structured tables from Docling's json_content.

    Docling's json_content schema (simplified):
      {
        "tables": [
          {
            "num_rows": int,
            "num_cols": int,
            "data": {
              "table_cells": [
                {"row_span": int, "col_span": int, "start_row_offset_idx": int,
                 "start_col_offset_idx": int, "text": str, "column_header": bool,
                 "row_header": bool}
              ]
            }
          }
        ]
      }

    Returns a list of dicts, one per table, with headers and rows normalized.
    """
    json_content = doc.get("json_content")
    if not json_content or not isinstance(json_content, dict):
        return []

    raw_tables = json_content.get("tables", [])
    if not isinstance(raw_tables, list):
        return []

    result = []
    for idx, table in enumerate(raw_tables):
        num_rows: int = table.get("num_rows", 0)
        num_cols: int = table.get("num_cols", 0)
        if num_rows == 0 or num_cols == 0:
            continue

        cells: list[dict] = (table.get("data") or {}).get("table_cells", [])
        if not cells:
            continue

        # Build a 2D grid (rows × cols) filled with empty strings
        grid: list[list[str]] = [[""] * num_cols for _ in range(num_rows)]
        header_rows: set[int] = set()

        for cell in cells:
            row: int = cell.get("start_row_offset_idx", 0)
            col: int = cell.get("start_col_offset_idx", 0)
            text: str = str(cell.get("text", "")).strip()
            if 0 <= row < num_rows and 0 <= col < num_cols:
                grid[row][col] = text
            if cell.get("column_header"):
                header_rows.add(row)

        # Separate header rows from data rows
        headers = [grid[r] for r in sorted(header_rows)] if header_rows else []
        data_rows = [grid[r] for r in range(num_rows) if r not in header_rows]

        result.append({
            "table_index": idx,
            "num_rows": num_rows,
            "num_cols": num_cols,
            "headers": headers,
            "rows": data_rows,
        })

    return result


def _mime_type(filename: str) -> str:
    ext = filename.lower().rsplit(".", 1)[-1]
    return {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "doc": "application/msword",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
    }.get(ext, "application/octet-stream")
