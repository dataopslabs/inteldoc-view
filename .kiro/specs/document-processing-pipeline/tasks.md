# Implementation Plan: Document Processing Pipeline

## Overview

Implement the Phase 2 document processing pipeline as a Python Lambda that orchestrates document parsing (Docling ECS), LLM field extraction (Bedrock), confidence scoring, and DynamoDB trace updates. Implementation follows a bottom-up approach: shared models first, then service clients, then the orchestrating handler, then CDK wiring. All code is Python 3.11 with Pydantic models, tested with pytest, moto, and hypothesis.

## Tasks

- [x] 1. Define Pydantic models and custom exceptions
  - [x] 1.1 Add ProcessingEvent, ExtractedField, and ExtractionResult models to `services/models.py`
    - `ProcessingEvent` with fields: trace_id, workspace_id, s3_key, filename, schema (dict, default {}), hitl_threshold (float, default 0.8), prompt_version (str, default "1.0.0")
    - `ExtractedField` with fields: field_name (str), value (Any), confidence (float, ge=0.0, le=1.0)
    - `ExtractionResult` with fields: fields (list[ExtractedField]), input_tokens (int), output_tokens (int)
    - _Requirements: 1.1, 4.3, 4.5, 4.6_

  - [x] 1.2 Create custom exception classes in `services/exceptions.py`
    - `DoclingError(Exception)` — HTTP errors from Docling service, stores status_code and body
    - `DoclingTimeoutError(Exception)` — Docling 60s timeout
    - `LLMError(Exception)` — Bedrock API errors, stores error_type and message
    - `LLMParsingError(Exception)` — Invalid JSON from LLM, stores raw_output
    - _Requirements: 3.4, 3.5, 4.7, 4.8_

- [-] 2. Implement Docling Client
  - [x] 2.1 Implement `DoclingClient` class in `services/docling-client/__init__.py`
    - Constructor reads `DOCLING_SERVICE_URL` from env var (overridable via parameter)
    - `parse_document(file_bytes: bytes, filename: str) -> str` sends multipart POST to `/convert`
    - Extract text from response JSON, concatenate pages with `--- Page N ---` markers
    - Raise `DoclingError` on HTTP 4xx/5xx with status code and body in message
    - Raise `DoclingTimeoutError` on 60s timeout
    - Use `httpx` for HTTP requests with configurable timeout (default 60s)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 2.2 Write property test: Docling client extracts text with page boundaries preserved
    - **Property 4: Docling client extracts text with page boundaries preserved**
    - Generate random Docling response JSON with varying page counts (1–20 pages), verify returned text contains all page content and page boundary markers
    - **Validates: Requirements 3.2, 3.3**

  - [x] 2.3 Write property test: Docling client propagates HTTP errors as exceptions
    - **Property 5: Docling client propagates HTTP errors as exceptions**
    - Generate random HTTP error status codes (400–599) and response bodies, verify `DoclingError` is raised with status code and body in message
    - **Validates: Requirements 3.4**

  - [x] 2.4 Write unit tests for Docling client
    - Test successful document parsing with mocked HTTP response
    - Test `DOCLING_SERVICE_URL` env var is read correctly
    - Test 60-second timeout configuration
    - Test timeout raises `DoclingTimeoutError`
    - _Requirements: 3.1, 3.5, 3.6_

- [-] 3. Implement LLM Reasoning Service
  - [x] 3.1 Implement `LLMReasoningService` class in `services/llm-reasoning/__init__.py`
    - Constructor reads `BEDROCK_MODEL_ID` from env var (overridable via parameter)
    - `extract_fields(parsed_text: str, schema: dict) -> ExtractionResult` calls Bedrock InvokeModel
    - Construct system prompt instructing JSON extraction with per-field confidence scores
    - Construct user prompt with parsed text and schema fields (name, type, description)
    - Parse response body JSON into `ExtractionResult` with fields and token counts
    - Raise `LLMError` on Bedrock API errors with error type and message
    - Raise `LLMParsingError` on invalid JSON with raw output (truncated to 500 chars)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [ ]* 3.2 Write property test: Prompt includes all schema fields
    - **Property 6: Prompt includes all schema fields with name, type, and description**
    - Generate random schemas with 1–20 fields (random names, types, descriptions), verify constructed prompt contains every field's name, type, and description
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x] 3.3 Write property test: Bedrock response parsing extracts fields and token counts
    - **Property 7: Bedrock response parsing extracts fields and token counts**
    - Generate random valid Bedrock response JSON with 1–10 fields and token counts, verify `ExtractionResult` contains all fields with correct values and token counts match
    - **Validates: Requirements 4.5, 4.6**

  - [x] 3.4 Write property test: Invalid LLM JSON raises parsing exception
    - **Property 8: Invalid LLM JSON raises parsing exception with raw output**
    - Generate random non-JSON strings and malformed JSON, verify `LLMParsingError` is raised with raw output in message
    - **Validates: Requirements 4.8**

  - [x] 3.5 Write unit tests for LLM Reasoning Service
    - Test successful field extraction with mocked Bedrock response (using moto)
    - Test `BEDROCK_MODEL_ID` env var is read correctly
    - Test Bedrock API error raises `LLMError`
    - _Requirements: 4.4, 4.7_

- [x] 4. Checkpoint — Ensure service clients are working
  - Ensure all tests pass, ask the user if questions arise.

- [-] 5. Implement confidence scoring and status determination
  - [x] 5.1 Implement `compute_confidence` and `determine_status` helper functions in `services/processor/__init__.py`
    - `compute_confidence(fields: list[ExtractedField]) -> float` returns mean of per-field confidences, or 1.0 if empty list
    - `determine_status(confidence: float, threshold: float) -> str` returns "completed" if confidence >= threshold, else "hitl_required"
    - _Requirements: 1.5, 1.6, 1.7, 5.1, 5.2, 5.3, 5.5_

  - [x] 5.2 Write property test: Confidence score is arithmetic mean
    - **Property 1: Confidence score is the arithmetic mean of per-field scores**
    - Generate random lists of `ExtractedField` objects with confidence values in [0.0, 1.0], verify computed confidence equals arithmetic mean within floating-point tolerance
    - **Validates: Requirements 1.5, 5.1**

  - [x] 5.3 Write property test: Status determination follows threshold comparison
    - **Property 2: Status determination follows confidence-threshold comparison**
    - Generate random (confidence, threshold) pairs in [0.0, 1.0], verify status is "completed" when confidence >= threshold and "hitl_required" when confidence < threshold
    - **Validates: Requirements 1.6, 1.7, 5.2, 5.3**

- [x] 6. Implement DynamoDB trace update operations
  - [x] 6.1 Implement trace update functions in `services/processor/__init__.py`
    - `update_trace_processing(trace_id: str)` — sets status to "processing"
    - `update_trace_success(trace_id, fields, confidence, tokens, latency, prompt_version)` — sets status, fields, confidence, tokens, latency, prompt_version
    - `update_trace_failed(trace_id: str, error: str)` — sets status to "failed" and error message
    - All use `UpdateItem` to preserve existing attributes (tenant_id, workspace_id, created_at, etc.)
    - _Requirements: 1.1, 1.6, 1.7, 1.8, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 6.2 Write property test: Successful trace update contains all required attributes
    - **Property 9: Successful trace update contains all required attributes**
    - Generate random extraction results (fields, confidence, tokens, latency, prompt_version), verify trace update call includes all required attributes
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 5.4**

  - [x] 6.3 Write property test: Trace updates preserve existing attributes
    - **Property 10: Trace updates preserve existing attributes**
    - Generate random pre-existing trace attributes, perform an update, verify all original attributes remain unchanged using moto DynamoDB mock
    - **Validates: Requirements 6.5**

  - [x] 6.4 Write unit tests for trace update operations
    - Test update_trace_processing sets status to "processing" (moto)
    - Test update_trace_success writes all fields correctly (moto)
    - Test update_trace_failed writes status and error (moto)
    - _Requirements: 1.1, 1.8, 6.1, 6.2, 6.3, 6.4_

- [-] 7. Implement Processor Lambda handler
  - [x] 7.1 Implement `handler(event, context)` function in `services/processor/__init__.py`
    - Parse event with `ProcessingEvent` Pydantic model (validation errors caught)
    - Record start_time before try block
    - Extract trace_id before try block for error handling
    - Orchestrate: update trace → download S3 → Docling parse → LLM extract → compute confidence → determine status → update trace
    - Top-level try/except catches all exceptions, calls `update_trace_failed`
    - Double-fault handling: if trace update fails during error handling, log both errors
    - Return `{"status": final_status}`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 8.1, 8.2, 8.3_

  - [x] 7.2 Write property test: Any processing exception results in a failed trace
    - **Property 3: Any processing exception results in a failed trace**
    - Mock pipeline stages to raise random exceptions (S3, Docling, LLM), verify handler catches exception and updates trace to "failed" with error message
    - **Validates: Requirements 1.8, 8.1**

  - [x] 7.3 Write unit tests for Processor Lambda handler
    - Test full successful pipeline end-to-end with mocked services (moto for S3/DynamoDB)
    - Test empty schema → confidence 1.0, status "completed"
    - Test S3 download failure → trace "failed"
    - Test Docling timeout → trace "failed" with timeout message
    - Test LLM parsing failure → trace "failed" with parsing message
    - Test double-fault: trace update fails during error handling → both errors logged
    - Test event validation failure → trace "failed" with validation errors
    - _Requirements: 1.1–1.8, 2.3, 5.5, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 8. Checkpoint — Ensure all Python tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Update CDK handler path and bundling
  - [x] 9.1 Update `infra/lib/processing-stack.ts` handler path and bundling command
    - Change `handler` from `workflow.handler.handler` to `processor.handler`
    - Update bundling `command` to copy `processor`, `docling-client`, `llm-reasoning`, `models.py`, and `exceptions.py` into the asset output
    - Ensure `httpx` dependency is installed (add requirements.txt or inline pip install)
    - _Requirements: 1.1_

- [x] 10. Final checkpoint — Ensure all tests pass and CDK synth succeeds
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use `hypothesis` library; unit tests use `pytest` with `moto` for AWS mocking
- The processor handler is designed as a clean module that Phase 3 can wrap with Strands agent tools
- Docling client and LLM reasoning service are independent modules reusable by Phase 3
