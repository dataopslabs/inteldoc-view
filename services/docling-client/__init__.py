"""Docling ECS service HTTP client for document parsing."""
from __future__ import annotations

import os

import httpx

from services.exceptions import DoclingError, DoclingTimeoutError


class DoclingClient:
    """HTTP client that sends documents to the Docling ECS service for parsing."""

    def __init__(
        self,
        service_url: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.service_url = (
            service_url or os.environ.get("DOCLING_SERVICE_URL", "")
        ).rstrip("/")
        self.timeout = timeout

    def parse_document(self, file_bytes: bytes, filename: str) -> str:
        """Send document to Docling for parsing and return text with page markers.

        Args:
            file_bytes: Raw document bytes.
            filename: Original filename (used in multipart upload).

        Returns:
            Parsed text with ``--- Page N ---`` markers between pages.

        Raises:
            DoclingError: On HTTP 4xx/5xx from the Docling service.
            DoclingTimeoutError: If the service does not respond within the timeout.
        """
        url = f"{self.service_url}/convert"
        files = {"file": (filename, file_bytes)}

        try:
            response = httpx.post(url, files=files, timeout=self.timeout)
        except httpx.TimeoutException:
            raise DoclingTimeoutError(self.timeout)

        if response.status_code >= 400:
            raise DoclingError(response.status_code, response.text)

        data = response.json()
        return self._extract_text(data)

    @staticmethod
    def _extract_text(data: dict) -> str:
        """Extract and concatenate page text from a Docling response.

        Supports two response shapes:
        - ``{"pages": [{"text": "..."}, ...]}``  (page-level)
        - ``{"text": "..."}``                     (flat)
        """
        pages: list[dict] | None = data.get("pages")
        if pages:
            parts: list[str] = []
            for idx, page in enumerate(pages, start=1):
                parts.append(f"--- Page {idx} ---")
                parts.append(page.get("text", ""))
            return "\n".join(parts)

        # Fallback: single text blob
        return data.get("text", "")
