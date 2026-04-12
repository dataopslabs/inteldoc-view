"""Property and unit tests for the Docling client.

Feature: document-processing-pipeline
"""
from __future__ import annotations

import importlib
import re
import types

import httpx
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from services.exceptions import DoclingError


def _load_docling_client() -> types.ModuleType:
    """Import the docling-client package (hyphenated directory name)."""
    import services.exceptions  # noqa: F401 — ensure exceptions module is importable

    loader = importlib.machinery.SourceFileLoader(
        "docling_client",
        "services/docling-client/__init__.py",
    )
    mod = types.ModuleType(loader.name)
    loader.exec_module(mod)
    return mod


_mod = _load_docling_client()
DoclingClient = _mod.DoclingClient


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

page_text_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P", "Z")),
    min_size=1,
    max_size=200,
)

docling_pages_strategy = st.lists(
    page_text_strategy,
    min_size=1,
    max_size=20,
)


# ---------------------------------------------------------------------------
# Feature: document-processing-pipeline, Property 4: Docling client extracts
# text with page boundaries preserved
# ---------------------------------------------------------------------------


@given(page_texts=docling_pages_strategy)
@settings(max_examples=200)
def test_property4_page_boundaries_preserved(page_texts: list[str]) -> None:
    """For any Docling response with 1-20 pages, the returned text must
    contain every page's content and a ``--- Page N ---`` marker for each page.
    """
    response_json = {"pages": [{"text": t} for t in page_texts]}

    result = DoclingClient._extract_text(response_json)

    # Every page marker must be present
    for idx in range(1, len(page_texts) + 1):
        assert f"--- Page {idx} ---" in result, (
            f"Missing page boundary marker for page {idx}"
        )

    # Every page's text content must appear in the result
    for idx, text in enumerate(page_texts, start=1):
        assert text in result, f"Page {idx} text not found in output"

    # The number of page markers must equal the number of pages
    marker_count = len(re.findall(r"--- Page \d+ ---", result))
    assert marker_count == len(page_texts), (
        f"Expected {len(page_texts)} page markers, found {marker_count}"
    )


@given(page_texts=docling_pages_strategy)
@settings(max_examples=200)
def test_property4_page_order_preserved(page_texts: list[str]) -> None:
    """Page markers must appear in ascending order (1, 2, 3, …)."""
    response_json = {"pages": [{"text": t} for t in page_texts]}

    result = DoclingClient._extract_text(response_json)

    markers = re.findall(r"--- Page (\d+) ---", result)
    assert markers == [str(i) for i in range(1, len(page_texts) + 1)]


# ---------------------------------------------------------------------------
# Strategies for Property 5
# ---------------------------------------------------------------------------

http_error_status_strategy = st.integers(min_value=400, max_value=599)

response_body_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N", "P", "Z", "S")),
    min_size=0,
    max_size=500,
)


# ---------------------------------------------------------------------------
# Feature: document-processing-pipeline, Property 5: Docling client propagates
# HTTP errors as exceptions
# ---------------------------------------------------------------------------


@given(status_code=http_error_status_strategy, body=response_body_strategy)
@settings(max_examples=200)
def test_property5_http_errors_raise_docling_error(
    status_code: int, body: str
) -> None:
    """For any HTTP error status code (400-599) and response body returned by
    the Docling service, ``parse_document`` must raise a ``DoclingError`` whose
    message contains both the status code and the response body, and whose
    attributes store the original values.
    """
    client = DoclingClient(service_url="http://fake-docling:8080")

    mock_response = httpx.Response(
        status_code=status_code,
        text=body,
        request=httpx.Request("POST", "http://fake-docling:8080/convert"),
    )

    def mock_post(*args, **kwargs):
        return mock_response

    original_post = httpx.post
    httpx.post = mock_post
    try:
        with pytest.raises(DoclingError) as exc_info:
            client.parse_document(b"dummy content", "test.pdf")

        err = exc_info.value
        # Attributes must match the generated values
        assert err.status_code == status_code
        assert err.body == body
        # The string representation must contain both status code and body
        assert str(status_code) in str(err)
        assert body in str(err)
    finally:
        httpx.post = original_post


# ---------------------------------------------------------------------------
# Unit tests for Docling client (Task 2.4)
# Requirements: 3.1, 3.5, 3.6
# ---------------------------------------------------------------------------


class TestDoclingClientUnit:
    """Unit tests for DoclingClient covering env var config, timeout, and
    successful parsing with mocked HTTP responses."""

    def test_successful_document_parsing(self, monkeypatch):
        """Successful POST to /convert returns parsed text from response JSON.

        Requirement 3.1: POST to Docling service with document bytes and filename.
        """
        response_json = {
            "pages": [
                {"text": "Hello from page one."},
                {"text": "Content on page two."},
            ]
        }
        mock_response = httpx.Response(
            status_code=200,
            json=response_json,
            request=httpx.Request("POST", "http://docling:8080/convert"),
        )

        captured: dict = {}

        def fake_post(url, *, files=None, timeout=None, **kwargs):
            captured["url"] = url
            captured["files"] = files
            captured["timeout"] = timeout
            return mock_response

        monkeypatch.setattr(httpx, "post", fake_post)

        client = DoclingClient(service_url="http://docling:8080")
        result = client.parse_document(b"pdf-bytes", "invoice.pdf")

        # Verify the request was sent to the correct endpoint
        assert captured["url"] == "http://docling:8080/convert"
        # Verify filename was passed in the multipart files
        assert captured["files"]["file"][0] == "invoice.pdf"
        # Verify parsed text contains both pages
        assert "Hello from page one." in result
        assert "Content on page two." in result
        assert "--- Page 1 ---" in result
        assert "--- Page 2 ---" in result

    def test_service_url_from_env_var(self, monkeypatch):
        """Constructor reads DOCLING_SERVICE_URL from environment when no
        explicit URL is provided.

        Requirement 3.6: Read URL from DOCLING_SERVICE_URL env var.
        """
        monkeypatch.setenv("DOCLING_SERVICE_URL", "http://env-docling:9090")
        client = DoclingClient()
        assert client.service_url == "http://env-docling:9090"

    def test_service_url_strips_trailing_slash(self, monkeypatch):
        """Trailing slashes on the service URL are stripped so /convert
        path is built correctly."""
        monkeypatch.setenv("DOCLING_SERVICE_URL", "http://env-docling:9090/")
        client = DoclingClient()
        assert client.service_url == "http://env-docling:9090"

    def test_explicit_url_overrides_env_var(self, monkeypatch):
        """An explicit service_url parameter takes precedence over the env var."""
        monkeypatch.setenv("DOCLING_SERVICE_URL", "http://env-url:1111")
        client = DoclingClient(service_url="http://explicit-url:2222")
        assert client.service_url == "http://explicit-url:2222"

    def test_default_timeout_is_60_seconds(self):
        """Default timeout is 60 seconds.

        Requirement 3.5: 60-second timeout.
        """
        client = DoclingClient(service_url="http://docling:8080")
        assert client.timeout == 60.0

    def test_timeout_passed_to_httpx(self, monkeypatch):
        """The configured timeout value is forwarded to httpx.post.

        Requirement 3.5: 60-second timeout configuration.
        """
        captured: dict = {}

        def fake_post(url, *, files=None, timeout=None, **kwargs):
            captured["timeout"] = timeout
            return httpx.Response(
                status_code=200,
                json={"text": "ok"},
                request=httpx.Request("POST", url),
            )

        monkeypatch.setattr(httpx, "post", fake_post)

        client = DoclingClient(service_url="http://docling:8080", timeout=45.0)
        client.parse_document(b"data", "file.pdf")
        assert captured["timeout"] == 45.0

    def test_timeout_raises_docling_timeout_error(self, monkeypatch):
        """httpx.TimeoutException is translated to DoclingTimeoutError.

        Requirement 3.5: Raise timeout exception on 60s timeout.
        """
        from services.exceptions import DoclingTimeoutError

        def fake_post(*args, **kwargs):
            raise httpx.TimeoutException("timed out")

        monkeypatch.setattr(httpx, "post", fake_post)

        client = DoclingClient(service_url="http://docling:8080")
        with pytest.raises(DoclingTimeoutError) as exc_info:
            client.parse_document(b"data", "file.pdf")

        assert exc_info.value.timeout == 60.0
        assert "60" in str(exc_info.value)
