"""Custom exceptions for the document processing pipeline."""


class DoclingError(Exception):
    """HTTP error from the Docling ECS service."""

    def __init__(self, status_code: int, body: str) -> None:
        self.status_code = status_code
        self.body = body
        super().__init__(f"Docling service error: HTTP {status_code} - {body}")


class DoclingTimeoutError(Exception):
    """Docling service did not respond within the timeout period."""

    def __init__(self, timeout: float = 60.0) -> None:
        self.timeout = timeout
        super().__init__(f"Docling service timed out after {timeout}s")


class LLMError(Exception):
    """Error from the Amazon Bedrock API."""

    def __init__(self, error_type: str, message: str) -> None:
        self.error_type = error_type
        self.message = message
        super().__init__(f"Bedrock API error: {error_type} - {message}")


class LLMParsingError(Exception):
    """LLM response could not be parsed as valid JSON."""

    def __init__(self, raw_output: str) -> None:
        self.raw_output = raw_output
        super().__init__(f"Failed to parse LLM response: {raw_output[:500]}")
