# Implementation Plan: Observability and Tracing

## Overview

Implement Phase 6 observability and tracing: TypeScript types for all metric response shapes; in-memory TTL metrics cache; pure-function metrics engine for dashboard aggregation, HITL metrics, agent step metrics, error analysis, time-series bucketing, and usage summary; DynamoDB helper for multi-workspace queries; four observability endpoint handlers; router wiring replacing the observability stub. Tests use vitest with aws-sdk-client-mock for unit tests and fast-check for property-based tests.

## Tasks

- [ ] 1. Add observability types and DynamoDB helper
  - [x] 1.1 Add observability response types to `api/src/models/types.ts`
    - Add `DashboardMetrics` interface with `total_traces`, `success_count`, `failure_count`, `hitl_required_count`, `success_rate`, `failure_rate`, `average_confidence`, `average_latency_ms`, `total_tokens`
    - Add `HitlMetrics` interface with `total_reviews`, `pending_count`, `in_review_count`, `resolved_count`, `average_review_duration_ms`, `average_correction_count`
    - Add `AgentMetrics` interface with `agent_name`, `total_executions`, `success_count`, `error_count`, `average_latency_ms`, `total_input_tokens`, `total_output_tokens`, `models` array
    - Add `ErrorGroup` interface with `error_message`, `count`
    - Add `TimeSeriesBucket` interface with `bucket_start`, `metrics: DashboardMetrics`
    - Add `WorkspaceMetricsGroup` interface with `workspace_id`, `workspace_name`, `metrics: DashboardMetrics`
    - Add `UsageSummary` interface with `total_documents_processed`, `total_tokens_consumed`, `workspace_count`, `active_sessions_count`, `plan`, `plan_limits`
    - Add `workspace_id` and `review_duration_ms` and `correction_count` fields to existing `HitlReview` interface
    - Add `error` field to existing `Trace` interface
    - _Requirements: 1.1, 5.2, 6.1, 7.1, 8.1, 9.1_

  - [x] 1.2 Add `queryAllForWorkspaces` helper to `api/src/lib/dynamo.ts`
    - Implement function that takes `tableName`, `indexName`, and `workspaceIds` string array
    - Execute parallel `queryIndex` calls for each workspace_id via `Promise.all`
    - Flatten and return concatenated results
    - _Requirements: 1.3, 4.1, 11.1_

- [ ] 2. Implement metrics cache
  - [x] 2.1 Create `api/src/lib/metrics-cache.ts` with `MetricsCache` class
    - Implement `CacheEntry<T>` interface with `data` and `expiresAt` fields
    - Constructor accepts `maxEntries` (default 100) and `defaultTtlMs` (default 60000)
    - Implement `get<T>(key)`: return cached data if TTL not expired, delete and return null otherwise
    - Implement `set<T>(key, data, ttlMs?)`: evict oldest entry if at capacity, then store with expiry
    - Implement `buildKey(tenantId, path, params)`: sort params alphabetically, join as `tenantId:path:k1=v1&k2=v2`
    - Implement `clear()` and `size` getter
    - Export module-level singleton `metricsCache`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 2.2 Write property test: cache returns identical results within TTL (Property 10)
    - **Property 10: Cache returns identical results within TTL**
    - Generate random cache keys and data, store with TTL, verify `get` returns identical data before expiry and null after expiry
    - **Validates: Requirements 10.1, 10.3, 10.4**

  - [x] 2.3 Write property test: cache evicts oldest entry when at capacity (Property 11)
    - **Property 11: Cache evicts oldest entry when at capacity**
    - Generate sequences of `set` operations exceeding max entries, verify cache size never exceeds limit and the earliest-inserted entry is evicted
    - **Validates: Requirements 10.5, 10.6**

- [ ] 3. Implement metrics engine — core computations
  - [x] 3.1 Implement `resolveTimeRange` and `filterByTimeRange` in `api/src/lib/metrics-engine.ts`
    - `resolveTimeRange`: parse `range` (24h, 7d, 30d), `start`/`end` ISO 8601; start/end takes precedence over range; default to last 30 days; throw on invalid timestamps or start > end
    - `filterByTimeRange`: filter records where `start <= created_at <= end`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 3.2 Implement `computeDashboardMetrics` in `api/src/lib/metrics-engine.ts`
    - Count traces by status (completed → success, failed → failure, hitl_required)
    - Compute `success_rate` and `failure_rate` as count/total (0 when total is 0)
    - Compute `average_confidence` from non-null values (0 when none)
    - Compute `average_latency_ms` from non-null values (0 when none)
    - Sum `total_tokens` treating null as 0
    - _Requirements: 1.1, 1.6, 1.7, 1.8_

  - [x] 3.3 Implement `computeHitlMetrics` in `api/src/lib/metrics-engine.ts`
    - Count reviews by status (pending, in_review, resolved)
    - Compute `average_review_duration_ms` only from resolved reviews with non-null `review_duration_ms`
    - Compute `average_correction_count` only from resolved reviews with non-null `correction_count`
    - Return 0 for averages when no qualifying records exist
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 3.4 Implement `computeAgentMetrics` in `api/src/lib/metrics-engine.ts`
    - Flatten `agent_steps` arrays from all traces
    - Group by `agent_name`, compute per-agent: `total_executions`, `success_count`, `error_count`, `average_latency_ms`, `total_input_tokens`, `total_output_tokens`
    - Sub-group by `model_id` within each agent for per-model breakdowns
    - Return empty array when no agent_steps exist
    - _Requirements: 5.1, 5.2, 5.4, 5.6_

  - [x] 3.5 Implement `computeErrorAnalysis` in `api/src/lib/metrics-engine.ts`
    - Filter to failed traces, group by `error` field, count occurrences
    - Sort by count descending, take top N (default 10)
    - Return empty array when no failed traces exist
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 3.6 Implement `computeTimeSeries` in `api/src/lib/metrics-engine.ts`
    - Bucket traces by calendar day (UTC) or ISO week (Monday start)
    - Fill empty buckets with zero-value `DashboardMetrics` for the full time range
    - Include `bucket_start` as ISO 8601 date string
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [x] 3.7 Implement `groupByWorkspace` and `computeUsageSummary` in `api/src/lib/metrics-engine.ts`
    - `groupByWorkspace`: group traces by `workspace_id`, compute independent `DashboardMetrics` per group, include workspace name from lookup map
    - `computeUsageSummary`: compute `total_documents_processed` (trace count), `total_tokens_consumed` (token sum), accept `workspace_count`, `active_sessions_count`, `plan`, `plan_limits`
    - _Requirements: 4.1, 4.2, 4.3, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 4. Checkpoint — Verify metrics engine compiles
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Write property tests for metrics engine
  - [x] 5.1 Write property test: rate sum equals 1.0 (Property 1)
    - **Property 1: Success rate plus failure rate plus hitl_required rate equals 1.0**
    - Generate random trace lists with various statuses, verify `success_rate + failure_rate + hitl_required_count / total_traces` equals 1.0 within floating-point tolerance; verify all rates are 0 when total_traces is 0
    - **Validates: Requirements 1.1, 1.6**

  - [x] 5.2 Write property test: average confidence is arithmetic mean of non-null values (Property 2)
    - **Property 2: Average confidence is the arithmetic mean of non-null confidence values**
    - Generate random trace lists with nullable confidence, verify computed average matches manual mean; verify 0 when all null
    - **Validates: Requirements 1.7**

  - [x] 5.3 Write property test: average latency is arithmetic mean of non-null values (Property 3)
    - **Property 3: Average latency is the arithmetic mean of non-null latency values**
    - Generate random trace lists with nullable latency, verify computed average matches manual mean; verify 0 when all null
    - **Validates: Requirements 1.8**

  - [x] 5.4 Write property test: time-range filtering correctness (Property 4)
    - **Property 4: Time-range filtering includes only records within bounds**
    - Generate random records with timestamps and time ranges, verify filtered result contains exactly records where `start <= created_at <= end`
    - **Validates: Requirements 2.1, 2.2**

  - [x] 5.5 Write property test: custom start/end takes precedence over range (Property 5)
    - **Property 5: Custom start/end takes precedence over range preset**
    - Generate query params with both `range` and `start`/`end`, verify resolved time range matches start/end values
    - **Validates: Requirements 2.3**

  - [x] 5.6 Write property test: total tokens equals sum of individual trace tokens (Property 6)
    - **Property 6: Total tokens equals sum of individual trace tokens**
    - Generate random traces with nullable tokens, verify `total_tokens` equals sum treating null as 0
    - **Validates: Requirements 1.1, 8.3**

  - [x] 5.7 Write property test: per-workspace metrics sum to tenant-wide metrics (Property 7)
    - **Property 7: Per-workspace metrics sum to tenant-wide metrics**
    - Generate random traces with workspace_ids, verify sum of `total_traces` and `total_tokens` across workspace groups equals tenant-wide totals
    - **Validates: Requirements 4.1, 4.3**

  - [x] 5.8 Write property test: agent step metrics consistency (Property 8)
    - **Property 8: Agent step metrics are consistent with trace-level totals**
    - Generate random traces with agent_steps arrays, verify sum of `total_executions` across agent groups equals total agent_step entries; verify token sums match
    - **Validates: Requirements 5.1, 5.2**

  - [x] 5.9 Write property test: error analysis sorted and capped (Property 9)
    - **Property 9: Error analysis groups are sorted by count descending and capped at limit**
    - Generate random failed traces with error messages, verify result is sorted by count desc, has at most `limit` entries, and count sum <= total failed traces
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [x] 5.10 Write property test: time-series buckets cover full range (Property 12)
    - **Property 12: Time-series buckets cover the full time range with no gaps**
    - Generate random date ranges and granularities, verify contiguous bucket sequence from start to end with no missing buckets; verify empty buckets have zero-value metrics
    - **Validates: Requirements 9.1, 9.2, 9.4**

  - [x] 5.11 Write property test: HITL averages from resolved reviews only (Property 13)
    - **Property 13: HITL average metrics computed only from resolved reviews**
    - Generate random review records with mixed statuses, verify `average_review_duration_ms` computed only from resolved reviews with non-null duration
    - **Validates: Requirements 6.2, 6.3**

- [ ] 6. Implement observability handlers
  - [x] 6.1 Implement `handleGetDashboard` in `api/src/handlers/observability.ts`
    - Check cache for matching key; return cached result if valid
    - Validate query params: time range, workspace_id, group_by, granularity
    - If `workspace_id` provided, verify tenant ownership; return 403 if not owned
    - Fetch tenant's workspaces via `tenant-index` on workspaces table
    - Fetch traces and HITL reviews via `queryAllForWorkspaces`
    - Filter by time range, compute `DashboardMetrics`, `HitlMetrics`, `ErrorAnalysis`
    - If `group_by=workspace`, call `groupByWorkspace`
    - If `granularity=daily|weekly`, call `computeTimeSeries`
    - Cache result and return response
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.4, 6.5, 7.1, 7.4, 9.1, 9.2, 9.3, 9.4, 9.5, 11.1, 11.3_

  - [x] 6.2 Implement `handleGetTraceMetrics` in `api/src/handlers/observability.ts`
    - Check cache; validate params; verify workspace ownership if specified
    - Fetch traces for tenant's workspaces, filter by time range and optional `status`
    - Sort by `created_at` descending
    - Return trace list with `count` field
    - Cache and return
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 6.3 Implement `handleGetAgentMetrics` in `api/src/handlers/observability.ts`
    - Check cache; validate params; verify workspace ownership if specified
    - Fetch traces, filter by time range
    - Compute `AgentMetrics` via `computeAgentMetrics`
    - Return agents array with `total_traces` count
    - Cache and return
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 6.4 Implement `handleGetUsage` in `api/src/handlers/observability.ts`
    - Check cache; resolve time range
    - Fetch all tenant workspaces (count), traces (filter by time range), sessions (count active)
    - Get tenant record for plan info
    - Compute `UsageSummary` and return
    - Cache and return
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [ ] 7. Wire routes in router
  - [x] 7.1 Update `api/src/router.ts` to import and route observability handlers
    - Import `handleGetDashboard`, `handleGetTraceMetrics`, `handleGetAgentMetrics`, `handleGetUsage` from `./handlers/observability`
    - Add route `GET /v1/observability` → `handleGetDashboard`
    - Add route `GET /v1/observability/traces` → `handleGetTraceMetrics`
    - Add route `GET /v1/observability/agents` → `handleGetAgentMetrics`
    - Add route `GET /v1/observability/usage` → `handleGetUsage`
    - Remove `/v1/observability` from `stubPaths` array
    - _Requirements: 1.1, 3.1, 5.1, 8.1_

- [x] 8. Checkpoint — Verify handlers and routes compile
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Write unit tests for handlers
  - [x] 9.1 Write unit tests for dashboard handler in `api/src/__tests__/observability.test.ts`
    - Mock DynamoDB using `aws-sdk-client-mock`
    - Test basic dashboard response with workspace filter
    - Test dashboard with `group_by=workspace` returns per-workspace metrics
    - Test dashboard with `granularity=daily` returns time-series buckets
    - Test 403 on workspace belonging to different tenant
    - Test 400 on invalid time range (start > end)
    - Test 400 on invalid ISO 8601 timestamp
    - Test 400 on invalid range preset
    - Test 400 on invalid granularity value
    - Test cache hit on repeated identical request
    - Test cache miss after TTL expiry
    - _Requirements: 1.1–1.8, 2.1–2.6, 4.1–4.5, 6.1–6.5, 7.1–7.5, 9.1–9.5, 10.1–10.4, 11.1–11.4_

  - [x] 9.2 Write unit tests for trace metrics handler in `api/src/__tests__/observability.test.ts`
    - Test trace list with status filter
    - Test trace list sorted by `created_at` descending
    - Test response includes `count` field
    - Test tenant isolation: 403 on other tenant's workspace
    - _Requirements: 3.1–3.7_

  - [x] 9.3 Write unit tests for agent metrics handler in `api/src/__tests__/observability.test.ts`
    - Test agent metrics with per-model breakdowns
    - Test empty agents array when no agent_steps exist
    - Test workspace filter applied to agent metrics
    - _Requirements: 5.1–5.6_

  - [x] 9.4 Write unit tests for usage handler in `api/src/__tests__/observability.test.ts`
    - Test usage summary with plan limits included
    - Test active_sessions_count counts only sessions with messages
    - Test time-range filtering applied to document and token counts
    - _Requirements: 8.1–8.7_

  - [x] 9.5 Write unit tests for metrics engine edge cases in `api/src/__tests__/metrics-engine.test.ts`
    - Test zero traces: all metrics are 0, rates are 0 (not NaN)
    - Test all null confidence: `average_confidence` is 0
    - Test all null latency: `average_latency_ms` is 0
    - Test no failed traces: `error_analysis` is empty array
    - Test no HITL reviews: all hitl metrics are 0
    - Test no resolved reviews: `average_review_duration_ms` is 0
    - Test single-day range with daily granularity: one bucket
    - Test weekly granularity crossing month boundary: correct bucket assignment
    - _Requirements: 1.6, 1.7, 1.8, 6.2, 6.3, 7.5, 9.1, 9.4_

  - [x] 9.6 Write unit tests for metrics cache in `api/src/__tests__/metrics-cache.test.ts`
    - Test cache hit returns stored data
    - Test cache miss after TTL expiry
    - Test cache at capacity evicts oldest entry
    - Test `buildKey` produces deterministic sorted keys
    - Test `clear` empties the cache
    - _Requirements: 10.1–10.6_

- [x] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- TypeScript is used for all code in this spec
- Property tests use `fast-check`, unit tests use `vitest` with `aws-sdk-client-mock`
- All endpoints enforce tenant isolation via workspace ownership checks (Requirements 11.1–11.4)
- No new infrastructure or DynamoDB tables needed; all queries use existing tables and GSIs
- The metrics cache is a Lambda-scoped singleton that survives warm invocations but resets on cold starts
