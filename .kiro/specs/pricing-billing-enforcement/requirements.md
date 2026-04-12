# Requirements Document

## Introduction

Phase 8 adds comprehensive pricing and billing enforcement to the DocOps platform. The existing system has a basic plan enforcer middleware that checks workspace count limits, but does not enforce document processing limits, token consumption limits, or chat session limits. This phase expands enforcement to cover all metered resources, adds plan management APIs, usage tracking with monthly resets, overage handling with soft/hard limits, and billing integration hooks for future Stripe integration.

## Glossary

- **Plan_Enforcer**: The middleware component that checks tenant resource consumption against plan limits before allowing API operations to proceed
- **Usage_Tracker**: The service component that records and aggregates resource consumption events per tenant per billing period
- **Billing_Period**: A calendar month (UTC) during which usage is accumulated; resets on the first day of each month at 00:00 UTC
- **Usage_Record**: A DynamoDB record that tracks cumulative resource consumption for a tenant within a single billing period
- **Plan_Manager**: The handler component that processes plan change requests and returns current plan status with usage data
- **Soft_Limit**: A usage threshold set at 80% of the hard limit that triggers warning headers without blocking requests
- **Hard_Limit**: The maximum allowed usage for a resource within a billing period; requests exceeding this limit are rejected
- **Grace_Period**: A 7-day window after a plan downgrade during which the previous plan's limits remain in effect
- **Usage_Event**: An immutable record of a billable action (document processed, tokens consumed, chat message sent) stored for billing reconciliation
- **Admin_Override**: A per-tenant configuration that replaces default plan limits with custom values, used for enterprise tenants
- **Tenant**: The multi-tenant entity that owns workspaces and is associated with a plan
- **Gateway**: The API Lambda that handles all HTTP requests and runs the middleware pipeline

## Requirements

### Requirement 1: Document Processing Limit Enforcement

**User Story:** As a platform operator, I want document processing to be limited per plan tier per month, so that resource consumption is controlled and monetizable.

#### Acceptance Criteria

1. WHEN a document processing request is received, THE Plan_Enforcer SHALL retrieve the tenant's current month Usage_Record and compare the document count against the plan's docs_per_month limit
2. WHEN the tenant's document count for the current Billing_Period has reached the Hard_Limit, THE Plan_Enforcer SHALL reject the request with HTTP 429 and a JSON body containing an error message and an upgrade URL
3. WHEN the tenant's document count for the current Billing_Period has reached the Soft_Limit (80% of docs_per_month), THE Plan_Enforcer SHALL allow the request and include an `X-Usage-Warning` response header with the current count and limit
4. WHEN a document is successfully submitted for processing, THE Usage_Tracker SHALL increment the document count in the tenant's current month Usage_Record

### Requirement 2: Token Consumption Limit Enforcement

**User Story:** As a platform operator, I want token consumption to be limited per plan tier per month, so that LLM costs are bounded per tenant.

#### Acceptance Criteria

1. THE Plan_Enforcer SHALL enforce monthly token consumption limits of 100,000 tokens for free plan, 5,000,000 tokens for pro plan, and unlimited tokens for enterprise plan
2. WHEN a document processing request is received, THE Plan_Enforcer SHALL check the tenant's cumulative token consumption for the current Billing_Period against the plan's token limit
3. WHEN the tenant's token consumption for the current Billing_Period has reached the Hard_Limit, THE Plan_Enforcer SHALL reject the request with HTTP 429 and a JSON body containing the current token usage, the limit, and an upgrade URL
4. WHEN the tenant's token consumption for the current Billing_Period has reached the Soft_Limit (80% of the token limit), THE Plan_Enforcer SHALL allow the request and include an `X-Token-Warning` response header
5. WHEN a document processing trace completes, THE Usage_Tracker SHALL add the trace's token count to the tenant's current month Usage_Record

### Requirement 3: Chat Session Limit Enforcement

**User Story:** As a platform operator, I want chat messages to be limited per plan tier per month, so that session-based LLM costs are controlled.

#### Acceptance Criteria

1. THE Plan_Enforcer SHALL enforce monthly chat message limits of 50 messages for free plan, 2,000 messages for pro plan, and unlimited messages for enterprise plan
2. WHEN a chat message request is received, THE Plan_Enforcer SHALL check the tenant's cumulative chat message count for the current Billing_Period against the plan's chat limit
3. WHEN the tenant's chat message count for the current Billing_Period has reached the Hard_Limit, THE Plan_Enforcer SHALL reject the request with HTTP 429 and a JSON body containing the current chat count, the limit, and an upgrade URL
4. WHEN a chat message is successfully processed, THE Usage_Tracker SHALL increment the chat message count in the tenant's current month Usage_Record

### Requirement 4: Workspace Limit Enforcement (Enhanced)

**User Story:** As a platform operator, I want the existing workspace limit enforcement to be integrated with the new usage tracking system, so that all limits are managed consistently.

#### Acceptance Criteria

1. WHEN a workspace creation request is received, THE Plan_Enforcer SHALL check the tenant's workspace count against the plan's workspace limit using the same enforcement pipeline as other resource limits
2. WHEN the workspace count has reached the Hard_Limit, THE Plan_Enforcer SHALL reject the request with HTTP 429 and a JSON body containing the current workspace count, the limit, and an upgrade URL
3. THE Plan_Enforcer SHALL return consistent error response shapes across all resource limit types, including the fields: error, resource_type, current_usage, limit, and upgrade_url

### Requirement 5: Plan Management API

**User Story:** As a tenant administrator, I want to view my current plan and change plans through the API, so that I can manage my subscription.

#### Acceptance Criteria

1. WHEN a GET request is sent to `/v1/tenant/plan`, THE Plan_Manager SHALL return the tenant's current plan tier, all plan limits, and current Billing_Period usage for each metered resource
2. WHEN a POST request is sent to `/v1/tenant/plan` with a valid target plan, THE Plan_Manager SHALL update the tenant's plan in the Tenant record
3. WHEN a plan upgrade is requested (free to pro, free to enterprise, pro to enterprise), THE Plan_Manager SHALL apply the new plan limits immediately
4. WHEN a plan downgrade is requested (enterprise to pro, enterprise to free, pro to free), THE Plan_Manager SHALL record the downgrade timestamp and set a Grace_Period of 7 days during which the previous plan's limits remain in effect
5. IF an invalid plan value is provided in the POST request, THEN THE Plan_Manager SHALL return HTTP 400 with a descriptive error message
6. WHEN the Grace_Period expires after a plan downgrade, THE Plan_Enforcer SHALL enforce the new (lower) plan's limits

### Requirement 6: Usage Record Management

**User Story:** As a platform operator, I want usage to be tracked per tenant per calendar month, so that billing is accurate and usage resets monthly.

#### Acceptance Criteria

1. THE Usage_Tracker SHALL store usage records keyed by tenant_id and Billing_Period (formatted as YYYY-MM)
2. WHEN the first metered action of a new Billing_Period occurs, THE Usage_Tracker SHALL create a new Usage_Record with all counters initialized to zero
3. THE Usage_Tracker SHALL update usage counters using DynamoDB atomic increment operations to ensure accuracy under concurrent requests
4. WHEN the Usage_Tracker retrieves a Usage_Record for a Billing_Period that has no record, THE Usage_Tracker SHALL treat all counters as zero

### Requirement 7: Overage Handling

**User Story:** As a tenant, I want clear feedback when approaching or exceeding plan limits, so that I can take action before being blocked.

#### Acceptance Criteria

1. WHEN a request is rejected due to a Hard_Limit, THE Gateway SHALL return HTTP 429 with a JSON body containing: error message, resource_type (documents, tokens, chats, workspaces), current_usage, limit, upgrade_url, and billing_period
2. WHEN a request triggers a Soft_Limit warning, THE Gateway SHALL include the warning in a response header without modifying the response body or status code
3. THE Gateway SHALL include an `X-Usage-Remaining` response header on every authenticated request showing remaining quota for the primary resource being consumed

### Requirement 8: Billing Integration Hooks

**User Story:** As a platform operator, I want billable actions to be recorded as immutable events, so that usage can be reconciled with a future billing provider.

#### Acceptance Criteria

1. WHEN a billable action occurs (document processed, tokens consumed, chat message sent), THE Usage_Tracker SHALL write a Usage_Event record containing: event_id, tenant_id, event_type, quantity, billing_period, and timestamp
2. WHEN a GET request is sent to `/v1/tenant/usage/export`, THE Gateway SHALL return all Usage_Event records for the tenant within the requested billing period
3. THE Usage_Event records SHALL be immutable; the Usage_Tracker SHALL only append new records and never modify or delete existing ones

### Requirement 9: Plan Limit Configuration

**User Story:** As a platform operator, I want plan limits to be configurable and overridable per tenant, so that enterprise customers can have custom limits.

#### Acceptance Criteria

1. THE Plan_Enforcer SHALL read plan limits from a centralized configuration that can be updated without code deployment
2. WHEN an Admin_Override exists for a tenant, THE Plan_Enforcer SHALL use the override limits instead of the default plan limits
3. WHEN a GET request is sent to `/v1/tenant/plan`, THE Plan_Manager SHALL indicate whether the tenant has custom limits via an Admin_Override
