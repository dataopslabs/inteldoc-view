# Requirements Document

## Introduction

Phase 2 of the DocOps Agentic Document Intelligence Platform implements the document processing pipeline. This pipeline takes uploaded documents (PDF, DOCX, images), parses them via the existing Docling ECS service, extracts structured fields using Amazon Bedrock LLM based on workspace-defined schemas, computes confidence scores, and flags low-confidence results for human-in-the-loop (HITL) review. The pipeline runs asynchronously as a Python Lambda invoked by the existing TypeScript API handler, updating DynamoDB trace records with processing results.

## Glossary

- **Processor_Lambda**: The Python AWS Lambda function (`docops-processor`) that orchestrates the document processing pipeline. Receives async invocation events from the API handler.
- **Docling_Client**: A Python HTTP client service that communicates with the existing Docling ECS service (via its ALB endpoint) to parse documents and perform OCR.
- **LLM_Reasoning_Service**: A Python service that calls Amazon Bedrock foundation models to extract structured fields from parsed document text based on a workspace schema.
- **Trace**: A DynamoDB record in the `docops-traces` table that tracks the lifecycle and results of a single document processing request. Statuses: pending, processing, completed, failed, hitl_required.
- **Workspace_Schema**: A JSON object defined on a Workspace that describes the fields to extract from documents (field names, types, descriptions).
- **HITL_Threshold**: A numeric value (0.0–1.0) configured per Workspace. When the overall extraction confidence score falls below this threshold, the trace is flagged for human review.
- **Confidence_Score**: A numeric value (0.0–1.0) representing the LLM's assessed certainty in the extracted field values. Computed as the average of per-field confidence scores returned by the LLM.
- **Extracted_Fields**: A list of objects containing field name, extracted value, and per-field confidence score, stored on the Trace record after successful processing.
- **Documents_Bucket**: The S3 bucket (`docops-documents-{account}-{region}`) where uploaded raw documents are stored under the `raw/` prefix.
- **Docling_Service**: The existing Docling ECS Fargate service running behind an ALB, providing document parsing and OCR capabilities.

## Requirements

### Requirement 1: Processor Lambda Entry Point and Orchestration

**User Story:** As a platform operator, I want the processor Lambda to orchestrate the full document processing pipeline, so that uploaded documents are automatically parsed, analyzed, and results are stored.

#### Acceptance Criteria

1. WHEN the Processor_Lambda receives an invocation event containing trace_id, workspace_id, s3_key, filename, schema, hitl_threshold, and prompt_version, THE Processor_Lambda SHALL update the Trace status to "processing" in DynamoDB before beginning any processing work.
2. WHEN the Processor_Lambda begins processing, THE Processor_Lambda SHALL download the document from the Documents_Bucket using the s3_key from the event payload.
3. WHEN the document is downloaded, THE Processor_Lambda SHALL send the document to the Docling_Client for parsing.
4. WHEN the Docling_Client returns parsed text, THE Processor_Lambda SHALL send the parsed text and the workspace schema to the LLM_Reasoning_Service for field extraction.
5. WHEN the LLM_Reasoning_Service returns extracted fields and confidence scores, THE Processor_Lambda SHALL compute an overall Confidence_Score as the mean of all per-field confidence scores.
6. WHEN processing completes successfully with an overall Confidence_Score at or above the HITL_Threshold, THE Processor_Lambda SHALL update the Trace record with status "completed", the Extracted_Fields, the overall Confidence_Score, token count, and processing latency in milliseconds.
7. WHEN processing completes successfully with an overall Confidence_Score below the HITL_Threshold, THE Processor_Lambda SHALL update the Trace record with status "hitl_required", the Extracted_Fields, the overall Confidence_Score, token count, and processing latency in milliseconds.
8. IF an unrecoverable error occurs at any stage of processing, THEN THE Processor_Lambda SHALL update the Trace record with status "failed" and store the error message on the Trace.

### Requirement 2: Document Download from S3

**User Story:** As a platform operator, I want the processor to reliably download uploaded documents from S3, so that they can be fed into the parsing pipeline.

#### Acceptance Criteria

1. WHEN the Processor_Lambda downloads a document, THE Processor_Lambda SHALL use the s3_key from the event payload to retrieve the object from the Documents_Bucket.
2. WHEN the document is downloaded, THE Processor_Lambda SHALL pass the raw bytes and the original filename to the Docling_Client.
3. IF the S3 GetObject call fails, THEN THE Processor_Lambda SHALL update the Trace status to "failed" with an error message indicating the S3 download failure.

### Requirement 3: Docling Client for Document Parsing

**User Story:** As a platform operator, I want a client service that calls the existing Docling ECS service, so that documents are parsed into machine-readable text.

#### Acceptance Criteria

1. THE Docling_Client SHALL send an HTTP POST request to the Docling_Service ALB endpoint with the document bytes and filename.
2. WHEN the Docling_Service returns a successful response, THE Docling_Client SHALL extract and return the parsed text content from the response body.
3. WHEN the Docling_Service returns a successful response containing page-level data, THE Docling_Client SHALL preserve page boundaries in the returned text.
4. IF the Docling_Service returns an HTTP error status code, THEN THE Docling_Client SHALL raise an exception containing the HTTP status code and response body.
5. IF the Docling_Service does not respond within 60 seconds, THEN THE Docling_Client SHALL raise a timeout exception.
6. THE Docling_Client SHALL read the Docling_Service URL from the DOCLING_SERVICE_URL environment variable.

### Requirement 4: LLM Reasoning Service for Field Extraction

**User Story:** As a platform operator, I want a service that uses Amazon Bedrock to extract structured fields from parsed document text, so that documents are converted into actionable structured data.

#### Acceptance Criteria

1. WHEN the LLM_Reasoning_Service receives parsed text and a Workspace_Schema, THE LLM_Reasoning_Service SHALL construct a prompt instructing the LLM to extract each field defined in the schema from the parsed text.
2. WHEN the LLM_Reasoning_Service constructs a prompt, THE LLM_Reasoning_Service SHALL include the field name, expected type, and description from the Workspace_Schema for each field to extract.
3. WHEN the LLM_Reasoning_Service constructs a prompt, THE LLM_Reasoning_Service SHALL instruct the LLM to return a JSON object containing each field's extracted value and a per-field confidence score between 0.0 and 1.0.
4. THE LLM_Reasoning_Service SHALL call the Amazon Bedrock InvokeModel API using the model ID from the BEDROCK_MODEL_ID environment variable.
5. WHEN the Bedrock API returns a response, THE LLM_Reasoning_Service SHALL parse the response body to extract the JSON object containing field values and confidence scores.
6. WHEN the Bedrock API returns a response, THE LLM_Reasoning_Service SHALL extract and return the total input and output token count from the response metadata.
7. IF the Bedrock API returns an error, THEN THE LLM_Reasoning_Service SHALL raise an exception containing the error type and message.
8. IF the LLM response does not contain valid JSON with the expected field structure, THEN THE LLM_Reasoning_Service SHALL raise a parsing exception with the raw LLM output for debugging.

### Requirement 5: Confidence Scoring and HITL Flagging

**User Story:** As a workspace owner, I want documents with low extraction confidence to be automatically flagged for human review, so that I can ensure data quality.

#### Acceptance Criteria

1. WHEN the Processor_Lambda computes the overall Confidence_Score, THE Processor_Lambda SHALL calculate the arithmetic mean of all per-field confidence scores returned by the LLM_Reasoning_Service.
2. WHEN the overall Confidence_Score is below the HITL_Threshold configured on the workspace, THE Processor_Lambda SHALL set the Trace status to "hitl_required".
3. WHEN the overall Confidence_Score is at or above the HITL_Threshold, THE Processor_Lambda SHALL set the Trace status to "completed".
4. WHEN the Trace status is set to "hitl_required", THE Processor_Lambda SHALL store the Extracted_Fields on the Trace record so reviewers can see the preliminary extraction results.
5. WHEN the Workspace_Schema contains zero fields, THE Processor_Lambda SHALL set the Confidence_Score to 1.0 and the Trace status to "completed".

### Requirement 6: Trace Record Updates with Processing Results

**User Story:** As a platform user, I want trace records to contain complete processing results, so that I can inspect extraction outcomes via the API.

#### Acceptance Criteria

1. WHEN processing completes (status "completed" or "hitl_required"), THE Processor_Lambda SHALL store the Extracted_Fields as a list of objects, each containing field_name, value, and confidence.
2. WHEN processing completes, THE Processor_Lambda SHALL store the total token count (input plus output tokens) on the Trace record.
3. WHEN processing completes, THE Processor_Lambda SHALL store the total processing latency in milliseconds on the Trace record, measured from the start of processing to completion.
4. WHEN processing completes, THE Processor_Lambda SHALL store the prompt_version from the event payload on the Trace record.
5. THE Processor_Lambda SHALL use DynamoDB UpdateItem operations to update Trace records, preserving any existing attributes not being modified.

### Requirement 7: Trace Retrieval API with Extracted Data

**User Story:** As a platform user, I want to retrieve trace details including extracted fields via the API, so that I can consume processing results programmatically.

#### Acceptance Criteria

1. WHEN a GET request is made to /v1/traces/:trace_id, THE API SHALL return the full Trace record including status, Extracted_Fields, Confidence_Score, token count, latency, and error (if present).
2. WHEN a GET request is made to /v1/workspaces/:id/traces, THE API SHALL return a list of Trace records for the workspace, sorted by created_at descending.
3. THE API SHALL verify that the requesting tenant owns the trace or workspace before returning data.

### Requirement 8: Error Handling and Resilience

**User Story:** As a platform operator, I want the processing pipeline to handle failures gracefully, so that errors are recorded and do not leave traces in an indeterminate state.

#### Acceptance Criteria

1. IF the Processor_Lambda encounters an unhandled exception, THEN THE Processor_Lambda SHALL catch the exception at the top level and update the Trace status to "failed" with the exception message.
2. IF the Trace status update itself fails during error handling, THEN THE Processor_Lambda SHALL log the original error and the update failure to CloudWatch Logs.
3. WHEN the Processor_Lambda starts processing, THE Processor_Lambda SHALL record the start timestamp so that latency can be computed even for failed traces.
4. IF the Docling_Client raises a timeout exception, THEN THE Processor_Lambda SHALL update the Trace status to "failed" with an error message indicating the Docling service timed out.
5. IF the LLM_Reasoning_Service raises a parsing exception, THEN THE Processor_Lambda SHALL update the Trace status to "failed" with an error message indicating the LLM response could not be parsed.
