# Implementation Plan: HITL Review System

## Overview

Implement the Phase 4 HITL review system: TypeScript API handlers for listing, getting, assigning, correcting, and resolving reviews; correction application logic; DynamoDB updateItem helper; router wiring; type updates; and a Python auto-creation hook in the Phase 3 workflow runner. Tests use vitest with aws-sdk-client-mock for unit tests and fast-check for property-based tests.

## Tasks

- [x] 1. Update data models and DynamoDB helper
  - [x] 1.1 Add `Correction` interface and enhance `HitlReview` interface in `api/src/models/types.ts`
    - Add `Correction` interface with `field_name: string`, `original_value: unknown`, `corrected_value: unknown`
    - Update `HitlReview` to include `workspace_id`, `corrections: Correction[]`, `assigned_at?`, `resolved_at?`, `review_duration_ms?`, `correction_count?`
    - _Requirements: 5.2, 7.1, 8.1, 8.2_

  - [x] 1.2 Add `updateItem` helper function to `api/src/lib/dynamo.ts`
    - Accept `tableName`, `key`, `updateExpression`, `expressionAttributeNames`, `expressionAttributeValues`, optional `conditionExpression`
    - Use `UpdateCommand` with `ReturnValues: 'ALL_NEW'`
    - Export the new function alongside existing helpers
    - _Requirements: 4.1, 5.1, 6.1_

- [x] 2. Implement correction application logic and property tests
  - [x] 2.1 Implement `applyCorrections` function in `api/src/handlers/hitl.ts`
    - Accept `fields` array (with `field_name`, `value`, `confidence`) and `corrections` array
    - Build a Map from corrections so later corrections override earlier ones for the same field_name
    - Return new fields array with matched fields updated to `corrected_value` and `confidence: 1.0`
    - Uncorrected fields remain unchanged; field count is preserved
    - _Requirements: 6.2, 5.7_

  - [x] 2.2 Write property test: applying corrections preserves uncorrected fields
    - **Property 1: Applying corrections preserves uncorrected fields**
    - Generate random fields arrays and corrections arrays with non-overlapping field_names, verify uncorrected fields retain original value and confidence
    - **Validates: Requirements 6.2**

  - [x] 2.3 Write property test: applying corrections replaces matched field values
    - **Property 2: Applying corrections replaces matched field values**
    - Generate random fields arrays and corrections with overlapping field_names, verify matched fields have corrected_value and confidence 1.0
    - **Validates: Requirements 6.2**

  - [x] 2.4 Write property test: correction application is idempotent on field count
    - **Property 3: Correction application is idempotent on field count**
    - Generate random fields arrays and corrections, verify output length equals input length
    - **Validates: Requirements 6.2**

  - [x] 2.5 Write property test: later corrections override earlier corrections for the same field
    - **Property 5: Later corrections override earlier corrections for the same field**
    - Generate corrections lists with duplicate field_names, verify last correction wins
    - **Validates: Requirements 5.7**

- [x] 3. Checkpoint — Verify correction logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement HITL handler endpoints
  - [x] 4.1 Implement `handleListReviews` in `api/src/handlers/hitl.ts`
    - Parse `workspace_id` and `status` query params
    - If `workspace_id` provided, verify tenant owns workspace via `getItem` on workspaces table; return 403 if not owned
    - If `status` provided, query `status-index` GSI; if both, query by status then filter by workspace_id
    - Sort results by `created_at` ascending, return `{ reviews, count }`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 4.2 Implement `handleGetReview` in `api/src/handlers/hitl.ts`
    - Get Review_Record by `trace_id`; return 404 if missing
    - Get Trace_Record by `trace_id`; verify tenant owns trace's workspace; return 403 if not
    - Return `{ review, trace }` including trace's `fields` array
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 4.3 Implement `handleAssignReview` in `api/src/handlers/hitl.ts`
    - Validate `reviewer` field in body; return 400 if missing
    - Get Review_Record; return 404 if missing; verify tenant ownership
    - If status is not `pending`, return 409
    - Use conditional update (`status = :pending`) to set `status = "in_review"`, `reviewer`, `assigned_at`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.4 Implement `handleSubmitCorrections` in `api/src/handlers/hitl.ts`
    - Validate each correction has `field_name`, `original_value`, `corrected_value`; return 400 with missing field name if invalid
    - Get Review_Record; return 404 if missing; verify tenant ownership
    - If status is not `in_review`, return 409
    - Append corrections using DynamoDB `list_append` update expression
    - Return updated review with full corrections list
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 4.5 Implement `handleResolveReview` in `api/src/handlers/hitl.ts`
    - Get Review_Record; return 404 if missing; verify tenant ownership
    - If status is not `in_review`, return 409
    - Compute `review_duration_ms` and `correction_count`
    - Update Review_Record to `resolved` with `resolved_at`, metrics
    - Apply corrections to Trace_Record fields using `applyCorrections`, set trace status to `completed`
    - If trace update fails, revert Review_Record status to `in_review` and return 500
    - Return resolved review with metrics
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.3, 8.1, 8.2, 8.3_

- [x] 5. Wire HITL routes into the router
  - [x] 5.1 Update `api/src/router.ts` to import HITL handlers and replace stubs with real routes
    - Import all five handlers from `./handlers/hitl`
    - Add route for `GET /v1/hitl` → `handleListReviews`
    - Add route for `GET /v1/hitl/:trace_id` → `handleGetReview`
    - Add route for `POST /v1/hitl/:trace_id/assign` → `handleAssignReview`
    - Add route for `POST /v1/hitl/:trace_id/corrections` → `handleSubmitCorrections`
    - Add route for `POST /v1/hitl/:trace_id/resolve` → `handleResolveReview`
    - Remove the `/v1/hitl/:trace_id/resolve` stub from `stubPaths`
    - _Requirements: 2.1, 3.1, 4.1, 5.1, 6.1_

- [x] 6. Checkpoint — Verify API handlers compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement auto-creation hook in Python workflow runner
  - [x] 7.1 Add `create_hitl_review` function to `services/workflow/runner.py`
    - Create a `hitl_table` reference using `boto3.resource("dynamodb")` and `HITL_REVIEWS_TABLE` env var
    - Implement `create_hitl_review(trace_id, workspace_id)` that puts a Review_Record with `status: "pending"`, empty corrections, `created_at` timestamp
    - Use `ConditionExpression: "attribute_not_exists(trace_id)"` to skip if review already exists; log warning on duplicate
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 7.2 Call `create_hitl_review` in `run_workflow` when terminal state is `hitl_pending`
    - After the `sm.transition(next_state, ...)` call in Stage 6, if `next_state == WorkflowState.hitl_pending`, call `create_hitl_review(trace_id, workspace_id)`
    - _Requirements: 1.1_

- [x] 8. Write handler unit tests and remaining property tests
  - [x] 8.1 Set up test infrastructure: install `fast-check`, `aws-sdk-client-mock` as dev dependencies, create `api/src/__tests__/` directory
    - Add `vitest` config if not present
    - _Requirements: all_

  - [x] 8.2 Write property test: review status transitions follow valid state machine
    - **Property 4: Review status transitions follow the valid state machine**
    - Generate sequences of operations (assign, correct, resolve) from arbitrary starting states, verify only valid transitions succeed
    - **Validates: Requirements 4.1, 4.2, 5.4, 6.1, 6.4**

  - [x] 8.3 Write property test: review duration is non-negative and consistent with timestamps
    - **Property 6: Review duration is non-negative and consistent with timestamps**
    - Generate random assigned_at/resolved_at timestamp pairs where resolved >= assigned, verify duration_ms equals difference and is non-negative
    - **Validates: Requirements 8.1**

  - [x] 8.4 Write property test: correction count matches corrections list length
    - **Property 7: Correction count matches corrections list length**
    - Generate random corrections lists, verify count equals length
    - **Validates: Requirements 8.2**

  - [x] 8.5 Write unit tests for HITL handler endpoints in `api/src/__tests__/hitl.test.ts`
    - Mock DynamoDB using `aws-sdk-client-mock`
    - Test `handleListReviews`: filtered by workspace_id, by status, by both, includes count
    - Test `handleGetReview`: returns review + trace, 404 on missing, 403 on wrong tenant
    - Test `handleAssignReview`: success, 409 on non-pending, 404 on missing, 400 on missing reviewer
    - Test `handleSubmitCorrections`: success, 400 on invalid correction, 409 on non-in_review, appends multiple batches
    - Test `handleResolveReview`: success with metrics, 409 on non-in_review, 500 with rollback on trace update failure
    - _Requirements: 2.1–2.6, 3.1–3.5, 4.1–4.5, 5.1–5.7, 6.1–6.7, 7.1–7.3, 8.1–8.3, 9.1–9.3_

  - [x] 8.6 Write lifecycle integration test in `api/src/__tests__/hitl-lifecycle.test.ts`
    - Full lifecycle: create review → list → get → assign → correct → correct again → resolve
    - Verify trace fields updated with corrections, trace status set to `completed`
    - Verify resolved review contains `reviewer`, `assigned_at`, `resolved_at`, `review_duration_ms`, `correction_count`
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- TypeScript is used for all API handler code; Python for the workflow auto-creation hook
- Property tests use `fast-check`, unit tests use `vitest` with `aws-sdk-client-mock`
- All endpoints enforce tenant isolation via workspace ownership checks (Requirement 9)
- The auto-creation hook goes in `services/workflow/runner.py` (Phase 3), not the Phase 2 processor
