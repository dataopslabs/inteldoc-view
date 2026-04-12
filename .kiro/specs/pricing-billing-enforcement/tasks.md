# Implementation Plan: Pricing and Billing Enforcement

## Overview

Implement Phase 8 pricing and billing enforcement: centralized plan limits with grace period and admin override; DynamoDB atomic-counter usage tracker with billing event recording; rewritten plan enforcer middleware for documents, tokens, chats, and workspaces; billing handlers for plan management and usage export; two new DynamoDB tables; router and handler pipeline integration; tenant model extensions. Tests use vitest with aws-sdk-client-mock for unit tests and fast-check for property-based tests.

## Tasks

- [x] 1. Extend types and add plan limits configuration
  - [x] 1.1 Extend Tenant interface and add billing types in `api/src/models/types.ts`
    - Add `previous_plan?: Plan`, `downgrade_at?: string`, `admin_override_limits?: PlanLimits` fields to `Tenant` interface
    - Add `PlanLimits` interface with `workspaces`, `docs_per_month`, `tokens_per_month`, `chats_per_month` (all number)
    - Add `UsageRecord` interface with `tenant_id`, `billing_period`, `documents`, `tokens`, `chats`, `updated_at`
    - Add `UsageEvent` interface with `event_id`, `tenant_id`, `event_type` (`'document_processed' | 'tokens_consumed' | 'chat_message'`), `quantity`, `billing_period`, `timestamp`, `metadata?`
    - Add `ResourceType` type: `'documents' | 'tokens' | 'chats' | 'workspaces'`
    - Add `EnforcementResult` interface with `allowed`, `warnings`, `rejection?`, `remaining?`
    - _Requirements: 1.1, 2.1, 3.1, 4.3, 6.1, 7.1, 8.1, 9.2_

  - [x] 1.2 Create `api/src/lib/plan-limits.ts` with centralized plan limit configuration
    - Export `DEFAULT_PLAN_LIMITS` record mapping each `Plan` to `PlanLimits` (free: 2/10/100k/50, pro: 20/500/5M/2000, enterprise: all Infinity)
    - Export `SOFT_LIMIT_RATIO = 0.8`
    - Implement `getEffectiveLimits(tenant)`: return `admin_override_limits` if present, else previous plan limits if within 7-day grace period, else default plan limits
    - Implement `getSoftLimit(hardLimit)`: return `Infinity` for infinite limits, else `Math.floor(hardLimit * 0.8)`
    - _Requirements: 1.3, 2.1, 2.4, 3.1, 5.4, 5.6, 9.1, 9.2_

- [x] 2. Implement DynamoDB helpers and usage tracker
  - [x] 2.1 Add table names and atomic increment helper to `api/src/lib/dynamo.ts`
    - Add `usage` and `usageEvents` entries to `TABLE_NAMES` using env vars with fallback defaults
    - Implement `atomicIncrement(tableName, key, field, amount)` using DynamoDB `UpdateCommand` with `ADD` expression
    - _Requirements: 6.3_

  - [x] 2.2 Create `api/src/lib/usage-tracker.ts`
    - Implement `getCurrentBillingPeriod()`: return current UTC month as `YYYY-MM`
    - Implement `getUsage(tenantId, billingPeriod?)`: fetch usage record from DynamoDB, return zero-initialized record if none exists
    - Implement `incrementUsage(tenantId, field, amount)`: atomically increment a usage counter for the current billing period
    - Implement `recordUsageEvent(tenantId, eventType, quantity, metadata?)`: write immutable usage event with ULID event_id
    - Implement `getUsageEvents(tenantId, billingPeriod)`: query billing-period-index GSI, filter by tenant_id
    - _Requirements: 1.4, 2.5, 3.4, 6.1, 6.2, 6.3, 6.4, 8.1, 8.2_

- [x] 3. Implement plan enforcer middleware
  - [x] 3.1 Rewrite `api/src/middleware/plan-enforcer.ts` with full resource enforcement
    - Implement `enforcePlanLimits(tenant, resourceType, requestedAmount?)`: check usage against effective limits for the given resource type
    - For `workspaces` resource type, query workspace count from DynamoDB instead of usage record
    - Return `EnforcementResult` with `allowed`, `warnings` (soft limit headers), `rejection` (429 details), and `remaining` quota
    - Hard limit: reject when `current + requestedAmount > limit`
    - Soft limit: add `X-Usage-Warning` header when `current >= softLimit`
    - Implement `buildLimitResponse(rejection)`: return 429 response with error, resource_type, current_usage, limit, billing_period, upgrade_url
    - Implement `buildWarningHeaders(result)`: return headers dict with warnings and `X-Usage-Remaining`
    - Implement `routeEnforcement(method, path, tenant)`: map routes to resource types (POST workspaces → workspaces, POST process → documents, POST chat → chats)
    - _Requirements: 1.1, 1.2, 1.3, 2.2, 2.3, 2.4, 3.2, 3.3, 4.1, 4.2, 4.3, 7.1, 7.2, 7.3_

- [x] 4. Checkpoint — Verify core modules compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement billing handlers
  - [x] 5.1 Create `api/src/handlers/billing.ts` with plan management and usage export
    - Implement `handleGetPlan(req)`: return tenant's plan, effective limits, current usage, grace period info, and `has_admin_override` flag
    - Implement `handleChangePlan(req)`: validate plan value, detect upgrade vs downgrade, update tenant record; upgrades apply immediately and clear grace period; downgrades set `downgrade_at` and `previous_plan`; return 400 for invalid or same plan
    - Implement `handleExportUsage(req)`: validate `billing_period` query param (YYYY-MM format), fetch and return usage events for tenant
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.2, 9.3_

- [x] 6. Wire routes and handler pipeline
  - [x] 6.1 Update `api/src/router.ts` to add billing routes
    - Import `handleGetPlan`, `handleChangePlan`, `handleExportUsage` from `./handlers/billing`
    - Add route `GET /v1/tenant/plan` → `handleGetPlan`
    - Add route `POST /v1/tenant/plan` → `handleChangePlan`
    - Add route `GET /v1/tenant/usage/export` → `handleExportUsage`
    - _Requirements: 5.1, 5.2, 8.2_

  - [x] 6.2 Integrate plan enforcement into `api/src/handler.ts` middleware pipeline
    - After tenant resolution, call `routeEnforcement(method, path, tenant)` before routing
    - If enforcement rejects, return 429 with rejection body and CORS headers
    - After successful route handling, merge warning headers and `X-Usage-Remaining` into response
    - _Requirements: 1.1, 1.2, 1.3, 2.2, 2.3, 3.2, 3.3, 4.1, 7.1, 7.2, 7.3_

  - [x] 6.3 Add usage tracking calls to existing handlers
    - In `api/src/handlers/process.ts`: after successful document submission, call `incrementUsage` for documents and `recordUsageEvent` with `document_processed`
    - Add token tracking hook: after trace completion, call `incrementUsage` for tokens and `recordUsageEvent` with `tokens_consumed`
    - In chat handler (when it exists): call `incrementUsage` for chats and `recordUsageEvent` with `chat_message`
    - _Requirements: 1.4, 2.5, 3.4, 8.1_

- [x] 7. Add infrastructure for new DynamoDB tables
  - [x] 7.1 Add usage and usage-events tables to `infra/lib/database-stack.ts`
    - Create `docops-usage` table with PK `tenant_id` (String) and SK `billing_period` (String), PAY_PER_REQUEST, RETAIN, point-in-time recovery
    - Create `docops-usage-events` table with PK `tenant_id` (String) and SK `event_id` (String), PAY_PER_REQUEST, RETAIN, point-in-time recovery
    - Add GSI `billing-period-index` on `docops-usage-events` with PK `billing_period`, ALL projection
    - _Requirements: 6.1, 8.1_

  - [x] 7.2 Update `infra/lib/api-stack.ts` to pass new table names as Lambda environment variables
    - Add `USAGE_TABLE` and `USAGE_EVENTS_TABLE` env vars to the API Lambda
    - Grant read/write permissions on both new tables to the Lambda role
    - _Requirements: 6.1, 8.1_

- [x] 8. Checkpoint — Verify full integration compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Write property-based tests for plan limits and enforcement
  - [ ]* 9.1 Write property test for soft limit calculation (Property 2)
    - **Property 2: Soft limit threshold is always 80% of hard limit**
    - Generate random finite limit values, verify `getSoftLimit(L)` equals `Math.floor(L * 0.8)`; verify infinite input returns infinite output
    - **Validates: Requirements 1.3, 2.4, 7.2**

  - [ ]* 9.2 Write property test for hard limit enforcement (Property 3)
    - **Property 3: Hard limit rejection occurs when usage plus requested amount exceeds limit**
    - Generate random (usage, limit, requestedAmount) tuples, verify enforcement rejects iff `usage + requestedAmount > limit`; verify infinite limits always allow
    - **Validates: Requirements 1.2, 2.3, 3.3, 4.2**

  - [ ]* 9.3 Write property test for grace period logic (Property 4)
    - **Property 4: Grace period uses previous plan limits for exactly 7 days**
    - Generate random downgrade timestamps and "now" values, verify effective limits equal previous plan when `now < downgrade_at + 7d` and current plan otherwise
    - **Validates: Requirements 5.4, 5.6**

  - [ ]* 9.4 Write property test for plan tier ordering (Property 5)
    - **Property 5: Plan tier ordering is consistent for upgrade/downgrade detection**
    - Generate random pairs of distinct plans, verify exactly one of upgrade/downgrade holds; verify ordering free < pro < enterprise
    - **Validates: Requirements 5.3, 5.4**

  - [ ]* 9.5 Write property test for billing period format (Property 6)
    - **Property 6: Billing period format is always YYYY-MM**
    - Generate random dates, verify `getCurrentBillingPeriod()` output matches `^\d{4}-(0[1-9]|1[0-2])$` regex
    - **Validates: Requirements 6.1**

  - [ ]* 9.6 Write property test for zero-initialized usage (Property 7)
    - **Property 7: Zero-initialized usage for missing billing periods**
    - Generate random tenant IDs and billing periods with no existing record, verify `getUsage` returns documents=0, tokens=0, chats=0
    - **Validates: Requirements 6.4**

  - [ ]* 9.7 Write property test for admin override precedence (Property 8)
    - **Property 8: Admin override limits take precedence over default plan limits**
    - Generate random tenants with/without overrides, verify `getEffectiveLimits` returns override values when present, default plan limits otherwise
    - **Validates: Requirements 9.2, 9.1**

  - [ ]* 9.8 Write property test for enforcement response shape (Property 9)
    - **Property 9: Enforcement response shape is consistent across all resource types**
    - Generate random rejection results across all resource types, verify response body contains exactly: error, resource_type, current_usage, limit, billing_period, upgrade_url
    - **Validates: Requirements 4.3, 7.1**

  - [ ]* 9.9 Write property test for effective limits priority chain (Property 11)
    - **Property 11: Effective limits priority chain**
    - Generate random tenant configurations (with/without override, with/without grace period), verify priority: admin_override > grace period previous plan > current plan defaults
    - **Validates: Requirements 9.2, 5.6**

- [ ] 10. Write unit tests for usage tracker and billing handlers
  - [ ]* 10.1 Write property test for usage counter monotonicity (Property 1)
    - **Property 1: Usage counter monotonically increases within a billing period**
    - Generate random sequences of increment amounts, verify final counter equals sum of all increments
    - **Validates: Requirements 6.3, 1.4, 2.5, 3.4**

  - [ ]* 10.2 Write property test for append-only usage events (Property 10)
    - **Property 10: Usage events are append-only**
    - Generate random event sequences, verify total event count equals number of `recordUsageEvent` calls; no events modified or deleted
    - **Validates: Requirements 8.3**

  - [ ]* 10.3 Write unit tests for usage tracker in `api/src/__tests__/usage-tracker.test.ts`
    - Mock DynamoDB using `aws-sdk-client-mock`
    - Test `getUsage` returns zero-initialized record when no record exists
    - Test `getUsage` returns stored record when it exists
    - Test `incrementUsage` sends correct UpdateCommand with ADD expression
    - Test `recordUsageEvent` writes event with ULID and correct fields
    - Test `getUsageEvents` queries GSI and filters by tenant_id
    - Test `getCurrentBillingPeriod` returns correct YYYY-MM format
    - _Requirements: 1.4, 2.5, 3.4, 6.1, 6.2, 6.3, 6.4, 8.1_

  - [ ]* 10.4 Write unit tests for billing handlers in `api/src/__tests__/billing-handlers.test.ts`
    - Mock DynamoDB using `aws-sdk-client-mock`
    - Test `handleGetPlan` returns plan, limits, usage, and admin override flag
    - Test `handleGetPlan` includes grace period info when active
    - Test `handleChangePlan` upgrade: plan updated immediately, grace period cleared
    - Test `handleChangePlan` downgrade: sets `downgrade_at` and `previous_plan`
    - Test `handleChangePlan` returns 400 for invalid plan value
    - Test `handleChangePlan` returns 400 for same plan
    - Test `handleExportUsage` returns events for valid billing period
    - Test `handleExportUsage` returns 400 for missing or invalid billing_period
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.2_

  - [ ]* 10.5 Write unit tests for plan enforcer in `api/src/__tests__/plan-enforcer.test.ts`
    - Mock DynamoDB using `aws-sdk-client-mock`
    - Test enforcement allows request when usage is below hard limit
    - Test enforcement rejects request when usage reaches hard limit
    - Test enforcement adds warning header when usage reaches soft limit (80%)
    - Test enforcement allows all requests for enterprise plan (Infinity limits)
    - Test enforcement uses admin override limits when present
    - Test enforcement uses previous plan limits during grace period
    - Test enforcement uses new plan limits after grace period expires
    - Test `buildLimitResponse` returns correct 429 shape with all required fields
    - Test `buildWarningHeaders` includes `X-Usage-Warning` and `X-Usage-Remaining`
    - Test `routeEnforcement` maps routes to correct resource types
    - Test workspace enforcement queries workspace count instead of usage record
    - _Requirements: 1.1, 1.2, 1.3, 2.2, 2.3, 2.4, 3.2, 3.3, 4.1, 4.2, 4.3, 5.6, 7.1, 7.2, 7.3, 9.2_

- [x] 11. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- TypeScript is used for all code in this spec
- Property tests use `fast-check`, unit tests use `vitest` with `aws-sdk-client-mock`
- The `ulid` package is needed for time-ordered unique IDs on usage events
- Usage tracking failures should fail-open (allow the request) and log errors to avoid blocking tenants due to infrastructure issues
- Usage event recording uses fire-and-forget pattern with error logging
- All 11 correctness properties from the design are covered across tasks 9 and 10
