# Implementation Plan: Full UI

## Overview

Build the complete Next.js frontend for DocOps Phase 7. Implementation order: shared infrastructure (auth, API client, shared components, Tailwind tokens), then update existing pages (dashboard, workspace detail, trace explorer), then build new pages (HITL, chat, observability, settings, login), then wire layout and navigation, then tests.

## Tasks

- [x] 1. Tailwind config and shared design tokens
  - [x] 1.1 Add Sentry design tokens to `tailwind.config.ts`
    - Add `sentry-bg`, `sentry-surface`, `sentry-lime`, `sentry-lime-bg` color tokens
    - _Requirements: 12.4, 5.8, 7.9_

- [x] 2. Auth infrastructure
  - [x] 2.1 Create `AuthProvider` component (`ui/src/components/AuthProvider.tsx`)
    - Create `AuthContext` with `user`, `loading`, `signOut` fields
    - On mount call `getCurrentUser()` from `aws-amplify/auth`, extract email, sub, custom:tenant_id
    - Listen to Amplify Hub auth events for sign-in/sign-out
    - Export `useAuth()` hook
    - _Requirements: 11.5, 11.6_
  - [x] 2.2 Create `AuthGuard` component (`ui/src/components/AuthGuard.tsx`)
    - Use `useAuth()` to check session; public paths: `/auth/login`, `/auth/callback`
    - If loading: show full-screen spinner
    - If unauthenticated and not on public path: redirect to `/auth/login`
    - If authenticated: render children
    - _Requirements: 11.3, 11.4_
  - [x] 2.3 Update root layout (`ui/src/app/layout.tsx`) to wrap with `AuthProvider` and `AuthGuard`
    - Wrap existing layout children with `<AuthProvider><AuthGuard>...</AuthGuard></AuthProvider>`
    - _Requirements: 11.3, 11.5_
  - [x] 2.4 Create login page (`ui/src/app/auth/login/page.tsx`)
    - Centered card with DocOps logo and "Sign in with Google" button
    - Button calls `signInWithRedirect({ provider: 'Google' })` from `aws-amplify/auth`
    - If already authenticated, redirect to `/dashboard`
    - Standalone layout (no sidebar/header)
    - _Requirements: 11.1, 11.2_
  - [x] 2.5 Write property test for AuthGuard redirect behavior
    - **Property 1: Auth guard redirects unauthenticated users to login**
    - **Validates: Requirements 11.3, 11.4**

- [x] 3. API client extensions
  - [x] 3.1 Add TypeScript interfaces to `ui/src/lib/api.ts`
    - Add `HitlReview`, `Correction`, `Session`, `SessionSummary`, `MemoryEntry`, `ChatResponse`, `DashboardResponse`, `DashboardMetrics`, `HitlMetrics`, `AgentMetric`, `AgentMetricsResponse`, `ErrorGroup`, `TimeRange`, `TimeSeriesBucket`, `WorkspaceMetricsGroup`, `UsageResponse` interfaces
    - _Requirements: 13.6_
  - [x] 3.2 Add `buildQuery` helper and HITL API methods to `api.ts`
    - Add `buildQuery()` utility for query string construction
    - Add `api.hitl.list()`, `api.hitl.get()`, `api.hitl.assign()`, `api.hitl.submitCorrections()`, `api.hitl.resolve()`
    - _Requirements: 13.1_
  - [x] 3.3 Add chat/session API methods to `api.ts`
    - Add `api.sessions.create()`, `api.sessions.list()`, `api.sessions.get()`, `api.sessions.delete()`, `api.sessions.chat()`
    - _Requirements: 13.2_
  - [x] 3.4 Add observability API methods to `api.ts`
    - Add `api.observability.dashboard()`, `api.observability.traces()`, `api.observability.agents()`, `api.observability.usage()`
    - _Requirements: 13.3_
  - [x] 3.5 Add 401 redirect logic to the `request()` function in `api.ts`
    - If response status is 401, redirect to `/auth/login`
    - If token expired, attempt Amplify session refresh before retrying
    - _Requirements: 12.7, 13.4, 13.5, 13.7_
  - [x] 3.6 Write property test for API client Bearer token attachment
    - **Property 2: API client attaches Bearer token to all authenticated requests**
    - **Validates: Requirements 13.4, 13.5**

- [x] 4. Shared UI components
  - [x] 4.1 Create `StatusBadge` component (`ui/src/components/StatusBadge.tsx`)
    - Accept `status` and `size` props
    - Map statuses to colors: pending→gray, processing→amber, completed→green, failed→red, hitl_required→indigo, in_review→amber, resolved→green
    - Render color-coded pill with background tint and colored text
    - _Requirements: 12.3_
  - [x] 4.2 Create `ConfidenceIndicator` component (`ui/src/components/ConfidenceIndicator.tsx`)
    - Accept `value` (0.0–1.0), `variant` (default|sentry), `showLabel` props
    - Default variant: green >= 0.8, amber >= 0.5, red < 0.5
    - Sentry variant: lime `#c2ef4e` with opacity scaling
    - Render horizontal bar + percentage label
    - _Requirements: 12.4_
  - [x] 4.3 Create `DropZone` component (`ui/src/components/DropZone.tsx`)
    - Accept `onFile`, `accept`, `disabled`, `uploading` props
    - Handle dragenter, dragover, dragleave, drop events
    - Visual states: idle (dashed border), dragover (indigo border), uploading (pulse), disabled (opacity)
    - Hidden file input triggered on click, filtered to supported types
    - _Requirements: 3.1, 3.3, 3.7_
  - [x] 4.4 Create `Skeleton` component (`ui/src/components/Skeleton.tsx`)
    - Accept `variant` (text|card|row), `count`, `className` props
    - Render animated pulse blocks matching expected content layout
    - _Requirements: 12.6_
  - [x] 4.5 Create `TimeRangeSelector` component (`ui/src/components/TimeRangeSelector.tsx`)
    - Accept `value` and `onChange` props
    - Preset buttons: 24h, 7d, 30d with active highlight
    - Custom range: two date inputs that override presets
    - _Requirements: 9.2_
  - [x] 4.6 Create `MetricCard` component (`ui/src/components/MetricCard.tsx`)
    - Accept `label`, `value`, `subtitle`, `trend`, `color` props
    - Render card with Linear panel styling (bg `#0f1011`, border `rgba(255,255,255,0.06)`)
    - _Requirements: 9.1_
  - [x] 4.7 Write property test for StatusBadge color consistency
    - **Property 3: Status badge color mapping is consistent across all pages**
    - **Validates: Requirements 12.3**
  - [x] 4.8 Write property test for ConfidenceIndicator color thresholds
    - **Property 4: Confidence indicator color thresholds are consistent**
    - **Validates: Requirements 12.4**
  - [x] 4.9 Write property test for DropZone file type filtering
    - **Property 9: DropZone accepts only supported file types**
    - **Validates: Requirements 3.1**

- [x] 5. Checkpoint - Shared infrastructure complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update existing pages with live data
  - [x] 6.1 Update Dashboard page (`ui/src/app/dashboard/page.tsx`) with live data
    - Fetch workspaces from `api.workspaces.list()`, usage from `api.observability.usage()`, recent traces from `api.observability.traces({ range: '7d' })`
    - Render usage stats row with 4 MetricCards, workspace cards grid, recent activity list (5 traces) with StatusBadge and ConfidenceIndicator
    - Show Skeleton placeholders while loading; inline error per section on failure
    - Workspace card click navigates to workspace detail; trace click navigates to trace detail
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
  - [x] 6.2 Write property test for dashboard independent section rendering
    - **Property 7: Dashboard sections render independently on partial API failure**
    - **Validates: Requirements 1.7, 9.9**
  - [x] 6.3 Update Workspace Detail page (`ui/src/app/workspaces/[id]/page.tsx`) with DropZone
    - Replace existing `<input type="file">` with `<DropZone>` component
    - On file drop/select: read as base64, submit to `POST /v1/workspaces/:id/process`
    - Show upload progress indicator (uploading → submitted → processing)
    - Display new trace in list with status `pending` after upload; link to trace detail
    - Show error message on upload failure
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  - [x] 6.4 Update Trace Explorer page (`ui/src/app/traces/page.tsx`) with full filters
    - Fetch traces from `api.observability.traces()` and workspaces from `api.workspaces.list()`
    - Add status filter dropdown (all, pending, processing, completed, failed, hitl_required)
    - Add workspace filter dropdown populated from tenant workspaces
    - Re-fetch on filter change with query params; display total trace count
    - Render trace rows with trace_id, filename, workspace name, StatusBadge, ConfidenceIndicator (sentry variant), timestamp
    - Click row navigates to `/traces/:trace_id`; Sentry styling for trace list panel
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [x] 6.5 Write property test for filter re-fetch with correct parameters
    - **Property 8: Filter changes trigger API re-fetch with correct parameters**
    - **Validates: Requirements 4.3, 4.5, 6.3, 9.3**

- [x] 7. Checkpoint - Existing page updates complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Build HITL review pages
  - [x] 8.1 Create HITL Review Queue page (`ui/src/app/hitl/page.tsx`)
    - Fetch reviews from `api.hitl.list()` and workspaces for filter dropdown
    - Status summary bar with count pills (pending, in_review, resolved)
    - Status filter dropdown and workspace filter dropdown
    - Review list rows: trace_id, workspace name, StatusBadge, reviewer, timestamp
    - Click row navigates to `/hitl/:trace_id`; Sentry styling
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - [x] 8.2 Create HITL Review Detail page (`ui/src/app/hitl/[trace_id]/page.tsx`)
    - Fetch review and trace from `api.hitl.get(trace_id)`
    - Review header with status badge, reviewer, timestamps
    - Conditional action buttons: pending → "Assign to me", in_review → "Submit corrections" + "Resolve", resolved → read-only metrics
    - Fields table: field_name, current value, ConfidenceIndicator (sentry variant), editable input (enabled when in_review)
    - Assign flow: call `api.hitl.assign()`, refresh data
    - Correction flow: collect changed fields as `Correction[]`, call `api.hitl.submitCorrections()`, refresh
    - Resolve flow: call `api.hitl.resolve()`, show resolution metrics
    - Error handling: display API errors inline, preserve unsaved corrections
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_
  - [x] 8.3 Write property test for HITL correction submission
    - **Property 5: HITL correction submission preserves all changed fields**
    - **Validates: Requirements 7.5**

- [x] 9. Build Chat Interface page
  - [x] 9.1 Create Chat Interface page (`ui/src/app/chat/page.tsx`)
    - Two-panel layout: left panel (workspace selector, "New chat" button, session list), right panel (conversation thread, message input)
    - Workspace selection: fetch workspaces, on select fetch sessions via `api.sessions.list()`
    - New chat: `api.sessions.create()`, add to list, select as active
    - Select session: `api.sessions.get()`, render memory as message thread
    - Send message: optimistic user message display, typing indicator, `api.sessions.chat()`, append response with token usage
    - Delete session: confirm, `api.sessions.delete()`, remove from list
    - Disable message input when no session selected
    - Error handling: show error inline, keep message in input
    - Message styling: user right-aligned (indigo bg), assistant left-aligned (panel bg), timestamps below
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_
  - [x] 9.2 Write property test for chat message ordering
    - **Property 6: Chat message ordering is preserved**
    - **Validates: Requirements 8.3, 8.4**
  - [x] 9.3 Write property test for optimistic chat message display
    - **Property 10: Optimistic chat message display followed by server confirmation**
    - **Validates: Requirements 8.5, 8.8**

- [x] 10. Build Observability Dashboard page
  - [x] 10.1 Create Observability Dashboard page (`ui/src/app/observability/page.tsx`)
    - On mount fetch `api.observability.dashboard()`, `api.observability.agents()`, `api.observability.usage()` with default range `7d`
    - Fetch workspaces for filter dropdown
    - TimeRangeSelector + workspace filter; re-fetch all on change
    - Summary row: 6 MetricCards (total traces, success rate, failure rate, avg confidence, avg latency, total tokens)
    - HITL metrics row: 4 MetricCards (total reviews, pending, avg duration, avg corrections)
    - Agent performance section: card per agent with execution count, success rate, avg latency, token usage
    - Error analysis section: table of top errors with count
    - Usage section: docs processed, tokens consumed, plan limits with progress bars
    - Workspace breakdown table when `group_by=workspace`
    - Skeleton loading per section; errors scoped per section
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

- [x] 11. Build Settings page
  - [x] 11.1 Create Settings page (`ui/src/app/settings/page.tsx`)
    - Display tenant email and tenant ID from `useAuth()`
    - Fetch usage from `api.observability.usage()` for plan info
    - Profile section: email, tenant ID (read-only)
    - Plan section: plan name, limits (workspaces, docs/month)
    - Usage section: current usage vs limits with progress bars
    - API section: API endpoint URL from env, copy button
    - Sign out button: call `signOut()` from auth context, redirect to `/auth/login`
    - Linear panel styling
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 12. Checkpoint - All new pages complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Sidebar and Header updates
  - [x] 13.1 Update Sidebar (`ui/src/components/Sidebar.tsx`)
    - Add `{ href: '/observability', label: 'Observability', icon: '◈' }` to NAV_ITEMS
    - Add `{ href: '/chat', label: 'Chat' }` and `{ href: '/settings', label: 'Settings' }` nav links
    - Display user email from `useAuth()` in footer
    - Update version text to "Phase 7 · Full UI"
    - _Requirements: 12.1, 12.2_
  - [x] 13.2 Update Header (`ui/src/components/Header.tsx`) with breadcrumb support
    - Add `breadcrumbs` prop: `{ label: string; href: string }[]`
    - Render breadcrumb trail; each except last is a link; last is current page title
    - _Requirements: 12.5_

- [x] 14. Checkpoint - All UI wired together
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Component and integration tests
  - [x] 15.1 Write component tests for shared components
    - Test `StatusBadge`: correct color for each status value
    - Test `ConfidenceIndicator`: color thresholds, sentry variant
    - Test `DropZone`: drag-and-drop events, file type filtering, disabled state
    - Test `TimeRangeSelector`: preset selection, custom date input, onChange callbacks
    - Test `MetricCard`: renders label, value, subtitle
    - Test `AuthGuard`: redirect for unauthenticated, render for authenticated
    - Files: `ui/src/__tests__/components/StatusBadge.test.tsx`, `ConfidenceIndicator.test.tsx`, `DropZone.test.tsx`, `TimeRangeSelector.test.tsx`, `MetricCard.test.tsx`, `AuthGuard.test.tsx`
    - _Requirements: 12.3, 12.4, 3.1, 9.2, 11.3_
  - [x] 15.2 Write page integration tests with MSW API mocking
    - Test Dashboard: data fetching, skeleton loading, error handling per section
    - Test Trace Explorer: filter changes trigger re-fetch, trace list rendering
    - Test HITL Queue: status filter, review list rendering
    - Test HITL Detail: assign/correct/resolve workflow, error preservation
    - Test Chat: session creation, message send/receive, optimistic updates
    - Test Observability: time range changes, workspace filter, metric cards
    - Test Settings: user info display, usage progress bars
    - Files: `ui/src/__tests__/pages/dashboard.test.tsx`, `traces.test.tsx`, `hitl-queue.test.tsx`, `hitl-detail.test.tsx`, `chat.test.tsx`, `observability.test.tsx`, `settings.test.tsx`
    - _Requirements: 1.1–1.7, 4.1–4.8, 6.1–6.7, 7.1–7.9, 8.1–8.10, 9.1–9.10, 10.1–10.5_
  - [x] 15.3 Write API client unit tests
    - Test `buildQuery` helper with various param combinations
    - Test 401 redirect logic
    - Test token attachment
    - File: `ui/src/__tests__/lib/api.test.ts`
    - _Requirements: 13.4, 13.5, 13.7, 12.7_

- [x] 16. Final checkpoint - All tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The design uses TypeScript (React/Next.js) throughout — no language selection needed
- Existing Phase 1 pages (workspace list, workspace settings, trace detail, auth callback) are kept as-is unless explicitly updated
