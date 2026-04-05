"""Docling API client — calls the existing Docling ECS service."""
from __future__ import annotations

import os
import httpx
from typing import Any


DOCLING_SERVICE_URL = os.environ.get("DOCLING_SERVICE_URL", "")
TIMEOUT = 60.0


class DoclingError(Exception):
    pass


def parse_document(file_bytes: bytes, filename: str) -> dict[str, Any]:
    """
    Submit a document to the Docling ECS service and return structured output.

    Returns:
        {
          "markdown": str,       # full markdown representation
          "fields": dict,        # extracted key-value fields (if schema applied)
          "metadata": dict,      # page count, doc type, etc.
        }
    """
    if not DOCLING_SERVICE_URL:
        raise DoclingError("DOCLING_SERVICE_URL is not configured")

    url = f"{DOCLING_SERVICE_URL.rstrip('/')}/parse"

    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(
                url,
                files={"file": (filename, file_bytes, _mime_type(filename))},
            )
            response.raise_for_status()
            return response.json()
    except httpx.TimeoutException as e:
        raise DoclingError(f"Docling request timed out: {e}") from e
    except httpx.HTTPStatusError as e:
        raise DoclingError(
            f"Docling returned {e.response.status_code}: {e.response.text}"
        ) from e
    except httpx.RequestError as e:
        raise DoclingError(f"Docling request failed: {e}") from e


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
