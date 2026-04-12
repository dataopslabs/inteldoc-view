# Requirements Document

## Introduction

Phase 6 of the DocOps platform adds observability and tracing capabilities. Platform operators and workspace owners need visibility into processing pipeline performance, error rates, usage patterns, and agent step behavior. All metrics are computed on-the-fly from existing DynamoDB records (traces, HITL reviews, sessions) and exposed through a set of REST API endpoints. Time-range filtering, per-workspace breakdowns, and a caching layer for expensive aggregations are included.

## Glossary

- **Observability_Service**: The set of API handlers in the TypeScript API layer that compute and return observability metrics from DynamoDB records.
- **Trace_Record**: A DynamoDB item in the `docops-traces` table containing processing status, confidence, tokens, latency, agent_steps, and timestamps.
- **Review_Record**: A DynamoDB item in the `docops-hitl-reviews` table containing review status, review_duration_ms, correction_count, and timestamps.
- **Session_Record**: A DynamoDB item in the `docops-sessions` table containing memory (message list) and timestamps.
- **Dashboard_Metrics**: An aggregate summary object containing total traces, success/failure rates, average confidence, average latency, and total tokens consumed.
- **Time_Range**: A filter specifying start and end timestamps for metric computation, supporting presets (last 24h, 7d, 30d) and custom ISO 8601 ranges.
- **Workspace_Breakdown**: A per-workspace grouping of metrics within a tenant's scope.
- **Agent_Step_Metrics**: Aggregated performance data derived from the `agent_steps` array on Trace_Records, broken down by agent name.
- **Usage_Summary**: A per-tenant aggregation of document counts, token consumption, and workspace counts used for billing and plan enforcement.
- **Metrics_Cache**: An in-memory TTL cache within the Lambda execution context that stores previously computed aggregation results to reduce DynamoDB read costs.

## Requirements

### Requirement 1: Aggregate Dashboard Metrics

**User Story:** As a workspace owner, I want to see a high-level summary of my processing pipeline performance, so that I can monitor system health at a glance.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/observability`, THE Observability_Service SHALL return Dashboard_Metrics containing: total_traces, success_count, failure_count, hitl_required_count, success_rate, failure_rate, average_confidence, average_latency_ms, and total_tokens.
2. WHEN a `workspace_id` query parameter is provided, THE Observability_Service SHALL compute metrics only from Trace_Records belonging to that workspace.
3. WHEN no `workspace_id` query parameter is provided, THE Observability_Service SHALL compute metrics across all workspaces owned by the requesting tenant.
4. THE Observability_Service SHALL verify that the requesting tenant owns the specified workspace before computing metrics.
5. IF the specified workspace does not exist or belongs to a different tenant, THEN THE Observability_Service SHALL return a 403 Forbidden response.
6. THE Observability_Service SHALL compute `success_rate` as `success_count / total_traces` and `failure_rate` as `failure_count / total_traces`, returning 0 when total_traces is 0.
7. THE Observability_Service SHALL compute `average_confidence` as the arithmetic mean of the `confidence` field across all Trace_Records that have a non-null confidence value.
8. THE Observability_Service SHALL compute `average_latency_ms` as the arithmetic mean of the `latency` field across all Trace_Records that have a non-null latency value.

### Requirement 2: Time-Range Filtering

**User Story:** As a workspace owner, I want to filter metrics by time range, so that I can analyze trends over specific periods.

#### Acceptance Criteria

1. WHEN a `range` query parameter is provided with value `24h`, `7d`, or `30d`, THE Observability_Service SHALL include only records with `created_at` within that period relative to the current time.
2. WHEN `start` and `end` query parameters are provided as ISO 8601 timestamps, THE Observability_Service SHALL include only records with `created_at` between `start` and `end` (inclusive).
3. WHEN both `range` and `start`/`end` parameters are provided, THE Observability_Service SHALL use the `start`/`end` parameters and ignore `range`.
4. WHEN no time-range parameters are provided, THE Observability_Service SHALL default to the last 30 days.
5. IF `start` is after `end`, THEN THE Observability_Service SHALL return a 400 Bad Request response with a descriptive error message.
6. IF `start` or `end` is not a valid ISO 8601 timestamp, THEN THE Observability_Service SHALL return a 400 Bad Request response identifying the invalid parameter.

### Requirement 3: Trace-Level Metrics with Filtering

**User Story:** As a workspace owner, I want to see per-trace metrics with filtering options, so that I can drill into individual processing results.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/observability/traces`, THE Observability_Service SHALL return a list of Trace_Records with their status, confidence, tokens, latency, and created_at fields.
2. WHEN a `status` query parameter is provided, THE Observability_Service SHALL return only Trace_Records matching that status value.
3. WHEN a `workspace_id` query parameter is provided, THE Observability_Service SHALL return only Trace_Records belonging to that workspace.
4. THE Observability_Service SHALL apply Time_Range filtering to the trace list using the same `range`, `start`, and `end` parameters as the dashboard endpoint.
5. THE Observability_Service SHALL sort results by `created_at` descending (newest first).
6. THE Observability_Service SHALL include a `count` field in the response indicating the total number of matching traces.
7. THE Observability_Service SHALL verify tenant ownership before returning trace data.

### Requirement 4: Per-Workspace Breakdown

**User Story:** As a platform operator, I want to see metrics broken down by workspace, so that I can compare performance across different workspace configurations.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/observability` with a `group_by=workspace` query parameter, THE Observability_Service SHALL return Dashboard_Metrics grouped by workspace_id.
2. THE Observability_Service SHALL include the workspace name alongside each workspace_id in the grouped response.
3. THE Observability_Service SHALL compute independent Dashboard_Metrics for each workspace (total_traces, success_rate, failure_rate, average_confidence, average_latency_ms, total_tokens).
4. THE Observability_Service SHALL apply Time_Range filtering to the grouped metrics.
5. THE Observability_Service SHALL return only workspaces owned by the requesting tenant.

### Requirement 5: Agent Step Performance Metrics

**User Story:** As a platform operator, I want to see how each agent in the processing pipeline performs, so that I can identify bottlenecks and optimize agent configurations.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/observability/agents`, THE Observability_Service SHALL return Agent_Step_Metrics aggregated from the `agent_steps` arrays across all matching Trace_Records.
2. THE Observability_Service SHALL group Agent_Step_Metrics by `agent_name` and compute for each: total_executions, success_count, error_count, average_latency_ms, total_input_tokens, total_output_tokens, and average_confidence (where applicable).
3. THE Observability_Service SHALL apply `workspace_id` and Time_Range filtering to the agent metrics.
4. THE Observability_Service SHALL include per-model breakdowns within each agent group when multiple `model_id` values are present.
5. THE Observability_Service SHALL verify tenant ownership before returning agent metrics.
6. IF no Trace_Records contain `agent_steps` data, THEN THE Observability_Service SHALL return an empty agents array with a total_traces count of 0.

### Requirement 6: HITL Review Metrics

**User Story:** As a platform operator, I want to see review throughput and quality metrics, so that I can monitor the human review process.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/observability` or `/v1/observability?group_by=workspace`, THE Observability_Service SHALL include HITL metrics in the response: total_reviews, pending_count, in_review_count, resolved_count, average_review_duration_ms, and average_correction_count.
2. THE Observability_Service SHALL compute `average_review_duration_ms` only from resolved Review_Records that have a non-null `review_duration_ms` value.
3. THE Observability_Service SHALL compute `average_correction_count` only from resolved Review_Records that have a non-null `correction_count` value.
4. THE Observability_Service SHALL apply Time_Range filtering to HITL metrics using the Review_Record's `created_at` field.
5. WHEN a `workspace_id` query parameter is provided, THE Observability_Service SHALL filter Review_Records by workspace_id.

### Requirement 7: Error Analysis

**User Story:** As a platform operator, I want to see the most common failure reasons, so that I can prioritize fixes for recurring issues.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/observability`, THE Observability_Service SHALL include an `error_analysis` object containing the top 10 most frequent error messages from failed Trace_Records.
2. THE Observability_Service SHALL group errors by their `error` field value and count occurrences.
3. THE Observability_Service SHALL sort error groups by count descending (most frequent first).
4. THE Observability_Service SHALL apply `workspace_id` and Time_Range filtering to error analysis.
5. IF no failed Trace_Records exist in the filtered set, THEN THE Observability_Service SHALL return an empty `error_analysis` array.

### Requirement 8: Tenant Usage Summary for Billing

**User Story:** As a platform operator, I want to see per-tenant usage metrics, so that I can enforce plan limits and prepare billing data.

#### Acceptance Criteria

1. WHEN a GET request is made to `/v1/observability/usage`, THE Observability_Service SHALL return a Usage_Summary for the requesting tenant containing: total_documents_processed, total_tokens_consumed, workspace_count, and active_sessions_count.
2. THE Observability_Service SHALL compute `total_documents_processed` as the count of Trace_Records across all tenant workspaces within the Time_Range.
3. THE Observability_Service SHALL compute `total_tokens_consumed` as the sum of the `tokens` field across all Trace_Records within the Time_Range.
4. THE Observability_Service SHALL compute `workspace_count` as the count of workspaces owned by the tenant.
5. THE Observability_Service SHALL compute `active_sessions_count` as the count of Session_Records with at least one message in the `memory` array within the Time_Range.
6. THE Observability_Service SHALL include the tenant's current `plan` and the plan limits (docs_per_month, workspaces) in the response.
7. THE Observability_Service SHALL apply Time_Range filtering to document and token counts.

### Requirement 9: Time-Series Aggregation

**User Story:** As a workspace owner, I want to see metrics over time in daily or weekly buckets, so that I can visualize trends.

#### Acceptance Criteria

1. WHEN a `granularity=daily` query parameter is provided on `/v1/observability`, THE Observability_Service SHALL return Dashboard_Metrics bucketed by calendar day (UTC).
2. WHEN a `granularity=weekly` query parameter is provided on `/v1/observability`, THE Observability_Service SHALL return Dashboard_Metrics bucketed by ISO week (Monday start, UTC).
3. THE Observability_Service SHALL include the bucket start date as an ISO 8601 date string in each time-series entry.
4. THE Observability_Service SHALL return empty buckets (with zero counts) for days or weeks within the Time_Range that have no data.
5. THE Observability_Service SHALL apply `workspace_id` filtering to time-series data.

### Requirement 10: Metrics Caching

**User Story:** As a platform operator, I want expensive metric computations to be cached, so that repeated dashboard loads do not cause excessive DynamoDB reads.

#### Acceptance Criteria

1. THE Observability_Service SHALL cache computed metrics in the Lambda execution context with a configurable TTL (default 60 seconds).
2. THE Observability_Service SHALL use a cache key derived from the tenant_id, endpoint path, and all query parameters (workspace_id, range, start, end, granularity, group_by, status).
3. WHEN a cached result exists for the same cache key and the TTL has not expired, THE Observability_Service SHALL return the cached result without querying DynamoDB.
4. WHEN the TTL has expired, THE Observability_Service SHALL recompute the metrics from DynamoDB and update the cache.
5. THE Observability_Service SHALL limit the cache to a maximum of 100 entries to prevent unbounded memory growth in the Lambda context.
6. WHEN the cache reaches 100 entries, THE Observability_Service SHALL evict the oldest entry before inserting a new one.

### Requirement 11: Access Control and Tenant Isolation

**User Story:** As a tenant, I want observability data to be scoped to my own workspaces, so that I cannot see metrics from other tenants.

#### Acceptance Criteria

1. THE Observability_Service SHALL filter all DynamoDB queries to include only workspaces owned by the requesting tenant.
2. THE Observability_Service SHALL use the existing tenant resolution middleware to identify the requesting tenant from the JWT token.
3. IF a request specifies a `workspace_id` that belongs to a different tenant, THEN THE Observability_Service SHALL return a 403 Forbidden response.
4. THE Observability_Service SHALL include only the requesting tenant's data in usage summary responses.
