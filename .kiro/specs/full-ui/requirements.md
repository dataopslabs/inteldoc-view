# Requirements Document

## Introduction

Phase 7 of the DocOps platform builds the complete Next.js frontend with all user-facing pages and components. Phase 1 scaffolded a basic UI shell (sidebar, header, dashboard placeholder, workspace CRUD, trace detail, auth callback). Phase 7 replaces placeholders with live data, adds missing pages (HITL review, chat, observability, settings), implements the full document upload experience, and wires all components to the API endpoints delivered in Phases 1–6. The UI follows a Linear design system for the shell and Sentry design system for trace explorer and HITL panels, both dark-mode with near-black canvas (#08090a).

## Glossary

- **Dashboard_Page**: The main landing page displaying workspace cards with usage metrics and recent activity across all tenant workspaces.
- **Workspace_Detail_Page**: The page showing a single workspace's configuration, document upload, and trace list.
- **Trace_Explorer**: The page and components for listing, filtering, and inspecting document processing traces with status and confidence filters.
- **Trace_Detail_View**: The detailed view of a single trace showing extracted fields, agent steps, workflow state, and confidence scores.
- **HITL_Review_Panel**: The page and components for the human-in-the-loop review queue, field correction interface, and resolve workflow.
- **Chat_Interface**: The page and components for conversational document querying, including session list, message input, and conversation display.
- **Observability_Dashboard**: The page displaying aggregate metrics charts, time-range selectors, workspace breakdowns, and agent performance data.
- **Settings_Page**: The page for tenant profile, plan information, and API key display.
- **Auth_Flow**: The Google OAuth login page, callback handling, and route protection middleware.
- **API_Client**: The TypeScript module (`ui/src/lib/api.ts`) that makes authenticated HTTP requests to the backend API.
- **Sidebar**: The persistent navigation component listing all platform sections.
- **Status_Badge**: A reusable component displaying trace or review status with color-coded styling.
- **Confidence_Indicator**: A reusable component displaying confidence scores with color gradients (Sentry lime accent #c2ef4e for high confidence).
- **Auth_Guard**: A client-side component or middleware that redirects unauthenticated users to the login page and protects all application routes.

## Requirements

### Requirement 1: Dashboard Page with Live Data

**User Story:** As a tenant, I want to see a dashboard with my workspace cards, usage metrics, and recent activity, so that I can monitor my platform usage at a glance.

#### Acceptance Criteria

1. WHEN the Dashboard_Page loads, THE Dashboard_Page SHALL fetch the tenant's workspaces from `GET /v1/workspaces` and display each as a card showing workspace name, document count, and last activity timestamp.
2. WHEN the Dashboard_Page loads, THE Dashboard_Page SHALL fetch usage data from `GET /v1/observability/usage` and display total documents processed, total tokens consumed, workspace count, and current plan with limits.
3. WHEN the Dashboard_Page loads, THE Dashboard_Page SHALL fetch recent traces from `GET /v1/observability/traces?range=7d` and display the five most recent traces with their status, filename, confidence, and timestamp.
4. WHEN a user clicks a workspace card, THE Dashboard_Page SHALL navigate to the Workspace_Detail_Page for that workspace.
5. WHEN a user clicks a recent trace entry, THE Dashboard_Page SHALL navigate to the Trace_Detail_View for that trace.
6. WHILE data is being fetched, THE Dashboard_Page SHALL display skeleton loading placeholders in place of cards and metrics.
7. IF any API request fails, THEN THE Dashboard_Page SHALL display an inline error message in the affected section without blocking other sections from rendering.

### Requirement 2: Workspace Detail Page

**User Story:** As a user, I want to see a workspace's full details including settings, document upload, and trace list, so that I can manage my workspace from a single page.

#### Acceptance Criteria

1. WHEN the Workspace_Detail_Page loads, THE Workspace_Detail_Page SHALL fetch the workspace from `GET /v1/workspaces/:id` and display its name, description, prompt version, HITL threshold, and schema.
2. WHEN the Workspace_Detail_Page loads, THE Workspace_Detail_Page SHALL fetch traces from `GET /v1/workspaces/:id/traces` and display them in a list sorted by creation date descending.
3. THE Workspace_Detail_Page SHALL provide a link to the workspace settings page at `/workspaces/:id/settings`.
4. THE Workspace_Detail_Page SHALL display each trace with its trace ID (truncated), filename, status badge, confidence score, and creation timestamp.
5. WHEN a user clicks a trace row, THE Workspace_Detail_Page SHALL navigate to the Trace_Detail_View for that trace.
6. IF the workspace does not exist or the user lacks access, THEN THE Workspace_Detail_Page SHALL display a 404 or 403 error message.

### Requirement 3: Document Upload with Drag-and-Drop

**User Story:** As a user, I want to upload documents via drag-and-drop or file picker with processing status tracking, so that I can submit documents for extraction without friction.

#### Acceptance Criteria

1. THE Workspace_Detail_Page SHALL provide a drag-and-drop zone that accepts PDF, DOCX, PNG, and JPG files.
2. WHEN a user drops a file onto the drop zone, THE Workspace_Detail_Page SHALL read the file as base64 and submit it to `POST /v1/workspaces/:id/process` with the filename and content_base64 fields.
3. WHEN a user clicks the drop zone, THE Workspace_Detail_Page SHALL open a native file picker dialog filtered to supported file types.
4. WHILE a file is being uploaded, THE Workspace_Detail_Page SHALL display a progress indicator showing the upload state (uploading, submitted, processing).
5. WHEN the upload API returns a trace_id, THE Workspace_Detail_Page SHALL display the new trace in the trace list with status `pending` and provide a link to the Trace_Detail_View.
6. IF the upload fails, THEN THE Workspace_Detail_Page SHALL display an error message with the failure reason from the API response.
7. WHEN a file is dragged over the drop zone, THE Workspace_Detail_Page SHALL visually highlight the drop zone with a border color change to indicate it is a valid drop target.

### Requirement 4: Trace Explorer with Filters

**User Story:** As a user, I want to browse all traces across workspaces with status and confidence filters, so that I can find and inspect specific processing results.

#### Acceptance Criteria

1. WHEN the Trace_Explorer page loads, THE Trace_Explorer SHALL fetch traces from `GET /v1/observability/traces` and display them in a list with trace ID, filename, workspace name, status, confidence, and creation timestamp.
2. THE Trace_Explorer SHALL provide a status filter dropdown allowing selection of: all, pending, processing, completed, failed, hitl_required.
3. WHEN a user selects a status filter, THE Trace_Explorer SHALL re-fetch traces with the `status` query parameter and update the displayed list.
4. THE Trace_Explorer SHALL provide a workspace filter dropdown populated from the tenant's workspaces, allowing filtering by workspace_id.
5. WHEN a user selects a workspace filter, THE Trace_Explorer SHALL re-fetch traces with the `workspace_id` query parameter and update the displayed list.
6. THE Trace_Explorer SHALL display the total count of matching traces.
7. WHEN a user clicks a trace row, THE Trace_Explorer SHALL navigate to the Trace_Detail_View for that trace.
8. THE Trace_Explorer SHALL sort traces by creation date descending (newest first).

### Requirement 5: Trace Detail View

**User Story:** As a user, I want to see the full details of a trace including extracted fields, agent steps, and workflow state, so that I can understand the processing results.

#### Acceptance Criteria

1. WHEN the Trace_Detail_View loads, THE Trace_Detail_View SHALL fetch the trace from `GET /v1/traces/:trace_id` and display all trace metadata: status, confidence, tokens, latency, filename, prompt version, and timestamps.
2. THE Trace_Detail_View SHALL display extracted fields in a list showing field name, Docling value, LLM value, final value, and per-field confidence with a Confidence_Indicator component.
3. THE Trace_Detail_View SHALL display the workflow pipeline as a visual state machine showing completed, active, and pending states.
4. WHEN the trace has agent_steps data, THE Trace_Detail_View SHALL display each agent step with agent name, status, latency, and token usage.
5. WHEN the trace status is `hitl_required`, THE Trace_Detail_View SHALL display a banner with a link to the HITL_Review_Panel for that trace.
6. WHEN the trace has validation errors, THE Trace_Detail_View SHALL display each validation error with the field name and error message.
7. IF the trace has an error field, THEN THE Trace_Detail_View SHALL display the error message in a prominent error banner.
8. WHEN the trace has fields with conflicts (Docling and LLM values differ), THE Trace_Detail_View SHALL visually highlight conflicting fields with an accent border.

### Requirement 6: HITL Review Queue

**User Story:** As a reviewer, I want to see a queue of traces requiring human review, so that I can pick and process reviews efficiently.

#### Acceptance Criteria

1. WHEN the HITL_Review_Panel page loads, THE HITL_Review_Panel SHALL fetch reviews from `GET /v1/hitl` and display them in a list with trace ID, workspace name, status, reviewer, and creation timestamp.
2. THE HITL_Review_Panel SHALL provide a status filter allowing selection of: all, pending, in_review, resolved.
3. WHEN a user selects a status filter, THE HITL_Review_Panel SHALL re-fetch reviews with the `status` query parameter.
4. THE HITL_Review_Panel SHALL provide a workspace filter dropdown to filter reviews by workspace_id.
5. THE HITL_Review_Panel SHALL display the total count of matching reviews and a breakdown by status (pending, in_review, resolved).
6. WHEN a user clicks a review row, THE HITL_Review_Panel SHALL navigate to the review detail view for that trace.
7. THE HITL_Review_Panel SHALL visually distinguish pending reviews from in_review and resolved reviews using Status_Badge color coding.

### Requirement 7: HITL Review Detail and Correction Interface

**User Story:** As a reviewer, I want to view a trace's extracted fields, correct values, and resolve the review, so that I can fix low-confidence extractions.

#### Acceptance Criteria

1. WHEN the HITL review detail view loads, THE HITL_Review_Panel SHALL fetch the review and trace from `GET /v1/hitl/:trace_id` and display the review status, reviewer, timestamps, and the trace's extracted fields.
2. THE HITL_Review_Panel SHALL display each extracted field with its current value, confidence score, and an editable input for the corrected value.
3. WHEN a review has status `pending`, THE HITL_Review_Panel SHALL display an "Assign to me" button that calls `POST /v1/hitl/:trace_id/assign` with the current user's identifier.
4. WHEN a review has status `in_review`, THE HITL_Review_Panel SHALL enable the field correction inputs and display a "Submit corrections" button.
5. WHEN a user modifies field values and clicks "Submit corrections", THE HITL_Review_Panel SHALL collect all changed fields as Correction objects and submit them to `POST /v1/hitl/:trace_id/corrections`.
6. WHEN a review has status `in_review` and corrections have been submitted, THE HITL_Review_Panel SHALL display a "Resolve" button that calls `POST /v1/hitl/:trace_id/resolve`.
7. WHEN a review is resolved, THE HITL_Review_Panel SHALL display the resolution metrics (review duration, correction count) and update the status to resolved.
8. IF any HITL API call fails, THEN THE HITL_Review_Panel SHALL display the error message from the API response without losing the user's unsaved corrections.
9. THE HITL_Review_Panel SHALL use the Sentry design system with lime accent (#c2ef4e) for confidence score indicators on the review fields.

### Requirement 8: Chat Interface

**User Story:** As a user, I want to chat with my processed documents through a conversational interface, so that I can query extracted data using natural language.

#### Acceptance Criteria

1. WHEN the Chat_Interface page loads, THE Chat_Interface SHALL display a workspace selector and, once a workspace is selected, fetch chat sessions from `GET /v1/workspaces/:id/sessions` and display them in a session list sidebar.
2. WHEN a user clicks "New chat", THE Chat_Interface SHALL create a new session via `POST /v1/workspaces/:id/sessions` and select it as the active session.
3. WHEN a user selects a session from the list, THE Chat_Interface SHALL fetch the full session from `GET /v1/sessions/:id` and display the conversation history (all Memory_Entry items) in a message thread.
4. THE Chat_Interface SHALL display user messages right-aligned and assistant messages left-aligned, each with a timestamp.
5. WHEN a user types a message and presses Enter or clicks Send, THE Chat_Interface SHALL submit the message to `POST /v1/sessions/:id/chat` and display the user message immediately in the thread.
6. WHEN the assistant response is received, THE Chat_Interface SHALL append the response to the conversation thread and display token usage metadata.
7. WHILE waiting for the assistant response, THE Chat_Interface SHALL display a typing indicator in the message thread.
8. IF the chat API returns an error, THEN THE Chat_Interface SHALL display the error message inline in the conversation thread without clearing the message input.
9. WHEN a user clicks the delete button on a session, THE Chat_Interface SHALL call `DELETE /v1/sessions/:id` and remove the session from the list.
10. THE Chat_Interface SHALL disable the message input when no session is selected.

### Requirement 9: Observability Dashboard

**User Story:** As a platform operator, I want to see metrics charts, time-range selectors, and workspace breakdowns, so that I can monitor processing pipeline health and performance.

#### Acceptance Criteria

1. WHEN the Observability_Dashboard loads, THE Observability_Dashboard SHALL fetch dashboard metrics from `GET /v1/observability` and display summary cards for total traces, success rate, failure rate, average confidence, average latency, and total tokens.
2. THE Observability_Dashboard SHALL provide a time-range selector with preset options (24h, 7d, 30d) and a custom date range picker.
3. WHEN a user changes the time range, THE Observability_Dashboard SHALL re-fetch all metrics with the updated `range` or `start`/`end` query parameters.
4. THE Observability_Dashboard SHALL fetch and display HITL review metrics (total reviews, pending, in_review, resolved, average review duration, average correction count) from the dashboard response.
5. THE Observability_Dashboard SHALL fetch agent performance metrics from `GET /v1/observability/agents` and display per-agent cards showing execution count, success rate, average latency, and token usage.
6. THE Observability_Dashboard SHALL provide a workspace filter dropdown and, when selected, re-fetch metrics with the `workspace_id` parameter.
7. WHEN the `group_by=workspace` option is selected, THE Observability_Dashboard SHALL display a per-workspace breakdown table showing metrics for each workspace.
8. THE Observability_Dashboard SHALL fetch and display the error analysis section showing the top error messages with occurrence counts.
9. IF any metrics API call fails, THEN THE Observability_Dashboard SHALL display an error message in the affected section without blocking other sections.
10. THE Observability_Dashboard SHALL display usage summary data from `GET /v1/observability/usage` including documents processed, tokens consumed, and plan limits.

### Requirement 10: Settings Page

**User Story:** As a tenant, I want to view my profile, plan information, and API configuration, so that I can manage my account settings.

#### Acceptance Criteria

1. WHEN the Settings_Page loads, THE Settings_Page SHALL display the tenant's email address and tenant ID from the authenticated session.
2. THE Settings_Page SHALL display the current plan name (free, pro, enterprise) and the plan limits (max workspaces, max documents per month).
3. THE Settings_Page SHALL fetch usage data from `GET /v1/observability/usage` and display current usage against plan limits with a visual progress indicator.
4. THE Settings_Page SHALL display the API endpoint URL from the environment configuration.
5. THE Settings_Page SHALL provide a sign-out button that calls the Amplify signOut function and redirects to the login page.

### Requirement 11: Authentication Flow and Route Protection

**User Story:** As a user, I want to sign in with Google OAuth and have all application routes protected, so that only authenticated users can access the platform.

#### Acceptance Criteria

1. THE Auth_Flow SHALL provide a login page at `/auth/login` with a "Sign in with Google" button that initiates the Cognito OAuth flow via Amplify.
2. WHEN the OAuth callback is received at `/auth/callback`, THE Auth_Flow SHALL process the authorization code, store tokens via Amplify, and redirect to the dashboard.
3. THE Auth_Guard SHALL check for a valid Amplify session on every protected route (all routes except `/auth/login` and `/auth/callback`).
4. IF no valid session exists, THEN THE Auth_Guard SHALL redirect the user to `/auth/login`.
5. THE Auth_Guard SHALL make the authenticated user's information (email, tenant ID) available to all child components via a React context provider.
6. WHEN a user clicks "Sign out", THE Auth_Flow SHALL call Amplify signOut, clear the session, and redirect to `/auth/login`.

### Requirement 12: Shared UI Components

**User Story:** As a developer, I want reusable shared components for navigation, status display, and loading states, so that the UI is consistent across all pages.

#### Acceptance Criteria

1. THE Sidebar SHALL display navigation links for: Dashboard, Workspaces, Traces, HITL Review, Chat, Observability, and Settings, with the active route highlighted.
2. THE Sidebar SHALL display the DocOps logo and the current user's email or avatar at the bottom.
3. THE Status_Badge component SHALL render a color-coded pill for each trace status: pending (gray), processing (amber), completed (green), failed (red), hitl_required (indigo).
4. THE Confidence_Indicator component SHALL render a progress bar with color gradient: green (#27a644) for confidence >= 0.8, amber (#f59e0b) for >= 0.5, red (#ef4444) for < 0.5, and lime (#c2ef4e) for Sentry-styled panels.
5. THE Header component SHALL display the current page title and a breadcrumb trail for nested pages (e.g., Workspaces > Invoice Processing > Settings).
6. WHILE any page is loading data, THE loading state component SHALL display animated skeleton placeholders matching the layout of the expected content.
7. IF an API request returns a 401 or 403 status, THEN THE API_Client SHALL redirect the user to the login page.

### Requirement 13: API Client Integration

**User Story:** As a developer, I want a complete API client module that covers all backend endpoints with proper authentication, so that all pages can fetch data consistently.

#### Acceptance Criteria

1. THE API_Client SHALL include methods for all HITL endpoints: list reviews, get review, assign review, submit corrections, and resolve review.
2. THE API_Client SHALL include methods for all chat endpoints: create session, list sessions, get session, delete session, and send chat message.
3. THE API_Client SHALL include methods for all observability endpoints: get dashboard, get trace metrics, get agent metrics, and get usage.
4. THE API_Client SHALL attach the Cognito Bearer token from the Amplify session to every authenticated request.
5. IF the Amplify session token is expired or missing, THEN THE API_Client SHALL attempt to refresh the session before making the request.
6. THE API_Client SHALL return typed responses matching the API response shapes defined in the backend handlers.
7. IF an API request returns a non-2xx status, THEN THE API_Client SHALL throw an error with the error message from the response body.
