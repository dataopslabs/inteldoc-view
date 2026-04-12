# Requirements Document

## Introduction

Phase 4 of the DocOps platform adds a Human-in-the-Loop (HITL) review system. When the document processing pipeline produces extraction results with confidence below the workspace threshold, traces are flagged as `hitl_required`. The HITL review system provides API endpoints for human reviewers to list pending reviews, claim assignments, submit field corrections, and resolve reviews. On resolution, corrected field values are written back to the trace record and the trace status transitions to `completed`.

## Glossary

- **HITL_Review_Service**: The set of API handlers in the TypeScript API layer that manage HITL review lifecycle operations (list, get, assign, correct, resolve).
- **Review_Record**: A DynamoDB item in the `docops-hitl-reviews` table representing a single HITL review, keyed by `trace_id`.
- **Trace_Record**: A DynamoDB item in the `docops-traces` table representing a document processing trace.
- **Correction**: An object containing `field_name`, `original_value`, and `corrected_value` representing a single field edit made by a reviewer.
- **Reviewer**: A string identifier (email or user ID) of the human assigned to review a trace.
- **Review_Status**: One of `pending`, `in_review`, or `resolved`.
- **Workspace**: A tenant-scoped configuration unit that owns traces and defines extraction schemas.

## Requirements

### Requirement 1: Auto-Create Review Record on HITL-Required Trace

**User Story:** As a platform operator, I want review records to be created automatically when a trace is flagged as hitl_required, so that no flagged trace is missed by the review queue.

#### Acceptance Criteria

1. WHEN the document processor sets a Trace_Record status to `hitl_required`, THE HITL_Review_Service SHALL create a Review_Record with the same `trace_id`, status `pending`, an empty corrections list, and a `created_at` timestamp.
2. IF a Review_Record already exists for the given `trace_id`, THEN THE HITL_Review_Service SHALL skip creation and log a warning.
3. THE HITL_Review_Service SHALL store the `workspace_id` from the Trace_Record on the Review_Record to enable workspace-scoped queries.

### Requirement 2: List Pending Reviews

**User Story:** As a reviewer, I want to see all reviews awaiting attention for a workspace, so that I can pick work from the queue.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/hitl` with a `workspace_id` query parameter, THE HITL_Review_Service SHALL return all Review_Records matching that workspace_id, sorted by `created_at` ascending (oldest first).
2. WHEN a GET request is made to `/v1/hitl` with a `status` query parameter, THE HITL_Review_Service SHALL return only Review_Records matching that status value.
3. WHEN a GET request is made to `/v1/hitl` with both `workspace_id` and `status` query parameters, THE HITL_Review_Service SHALL return Review_Records matching both filters.
4. THE HITL_Review_Service SHALL include the total count of matching reviews in the response body.
5. THE HITL_Review_Service SHALL verify that the requesting tenant owns the workspace before returning results.
6. IF the specified workspace does not exist or belongs to a different tenant, THEN THE HITL_Review_Service SHALL return a 403 Forbidden response.

### Requirement 3: Get Review Details

**User Story:** As a reviewer, I want to see the full review record alongside the original trace data, so that I can understand what needs correction.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/hitl/:trace_id`, THE HITL_Review_Service SHALL return the Review_Record and the associated Trace_Record in a single response.
2. THE HITL_Review_Service SHALL include the trace's extracted `fields` array in the response so the reviewer can see original extraction results.
3. IF the Review_Record does not exist for the given `trace_id`, THEN THE HITL_Review_Service SHALL return a 404 Not Found response.
4. THE HITL_Review_Service SHALL verify tenant ownership of the associated trace before returning the review.
5. IF the trace belongs to a different tenant, THEN THE HITL_Review_Service SHALL return a 403 Forbidden response.

### Requirement 4: Assign Reviewer

**User Story:** As a reviewer, I want to claim a pending review, so that other reviewers know it is being worked on.

#### Acceptance Criteria

1. WHEN a POST request is made to `/v1/hitl/:trace_id/assign` with a `reviewer` field in the body, THE HITL_Review_Service SHALL update the Review_Record's `reviewer` field and set status to `in_review`.
2. IF the Review_Record status is not `pending`, THEN THE HITL_Review_Service SHALL return a 409 Conflict response with a message indicating the review is already assigned or resolved.
3. IF the Review_Record does not exist for the given `trace_id`, THEN THE HITL_Review_Service SHALL return a 404 Not Found response.
4. THE HITL_Review_Service SHALL record an `assigned_at` timestamp on the Review_Record when assignment succeeds.
5. THE HITL_Review_Service SHALL verify tenant ownership before allowing assignment.

### Requirement 5: Submit Field Corrections

**User Story:** As a reviewer, I want to submit corrections to extracted field values, so that the document data is accurate.

#### Acceptance Criteria

1. WHEN a POST request is made to `/v1/hitl/:trace_id/corrections` with a `corrections` array in the body, THE HITL_Review_Service SHALL append each Correction to the Review_Record's corrections list.
2. Each Correction in the request body SHALL contain `field_name`, `original_value`, and `corrected_value`.
3. IF any Correction is missing a required field (`field_name`, `original_value`, or `corrected_value`), THEN THE HITL_Review_Service SHALL return a 400 Bad Request response identifying the missing field.
4. IF the Review_Record status is not `in_review`, THEN THE HITL_Review_Service SHALL return a 409 Conflict response indicating corrections can only be submitted for reviews in `in_review` status.
5. IF the Review_Record does not exist for the given `trace_id`, THEN THE HITL_Review_Service SHALL return a 404 Not Found response.
6. THE HITL_Review_Service SHALL verify tenant ownership before accepting corrections.
7. THE HITL_Review_Service SHALL allow multiple correction submissions for the same review, appending each batch to the existing corrections list.

### Requirement 6: Resolve Review

**User Story:** As a reviewer, I want to mark a review as resolved, so that corrected data flows back to the trace and the review is closed.

#### Acceptance Criteria

1. WHEN a POST request is made to `/v1/hitl/:trace_id/resolve`, THE HITL_Review_Service SHALL set the Review_Record status to `resolved` and record a `resolved_at` timestamp.
2. WHEN a review is resolved, THE HITL_Review_Service SHALL update the associated Trace_Record's `fields` array by applying all corrections (replacing each field's value with the `corrected_value` where `field_name` matches).
3. WHEN a review is resolved, THE HITL_Review_Service SHALL set the associated Trace_Record's status to `completed`.
4. IF the Review_Record status is not `in_review`, THEN THE HITL_Review_Service SHALL return a 409 Conflict response.
5. IF the Review_Record does not exist for the given `trace_id`, THEN THE HITL_Review_Service SHALL return a 404 Not Found response.
6. IF the Trace_Record update fails during resolution, THEN THE HITL_Review_Service SHALL revert the Review_Record status back to `in_review` and return a 500 Internal Server Error response.
7. THE HITL_Review_Service SHALL verify tenant ownership before allowing resolution.

### Requirement 7: Review History and Audit Trail

**User Story:** As a platform operator, I want to see who reviewed what and when, so that I have an audit trail of all corrections.

#### Acceptance Criteria

1. THE HITL_Review_Service SHALL store the `reviewer` identifier, `assigned_at` timestamp, `resolved_at` timestamp, and full corrections list on every resolved Review_Record.
2. WHEN a GET request is made to `/v1/hitl/:trace_id` for a resolved review, THE HITL_Review_Service SHALL return the complete review history including reviewer, timestamps, and all corrections.
3. THE HITL_Review_Service SHALL preserve the original corrections list without modification after resolution (corrections are append-only).

### Requirement 8: Review Metrics

**User Story:** As a platform operator, I want to track review performance metrics, so that I can monitor review throughput and quality.

#### Acceptance Criteria

1. WHEN a review is resolved, THE HITL_Review_Service SHALL compute `review_duration_ms` as the difference between `resolved_at` and `assigned_at` and store it on the Review_Record.
2. WHEN a review is resolved, THE HITL_Review_Service SHALL store `correction_count` (the total number of corrections applied) on the Review_Record.
3. THE HITL_Review_Service SHALL include `review_duration_ms` and `correction_count` in the response when returning resolved Review_Records.

### Requirement 9: Workspace-Scoped Access Control

**User Story:** As a tenant, I want HITL reviews to be scoped to my workspaces, so that I cannot see or modify reviews belonging to other tenants.

#### Acceptance Criteria

1. THE HITL_Review_Service SHALL verify tenant ownership on every HITL endpoint by checking that the workspace associated with the trace belongs to the requesting tenant.
2. IF a request targets a Review_Record whose associated trace belongs to a different tenant, THEN THE HITL_Review_Service SHALL return a 403 Forbidden response.
3. THE HITL_Review_Service SHALL use the existing tenant resolution middleware to identify the requesting tenant from the JWT token.
