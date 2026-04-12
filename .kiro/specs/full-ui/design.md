# Design Document: Full UI

## Overview

This design covers Phase 7 of the DocOps platform: the complete Next.js frontend. Phase 1 scaffolded a basic shell (sidebar, header, dashboard placeholder, workspace CRUD, trace detail, auth callback). Phase 7 replaces all placeholders with live data, adds missing pages (HITL review, chat, observability, settings, login), implements drag-and-drop upload, wires all components to the Phase 1–6 API endpoints, and adds auth route protection.

The UI follows three design systems per `designui.md`:
- **Linear** for shell (sidebar, dashboard, workspace cards): near-black canvas `#08090a`, indigo accent `#7170ff`, Inter font weight 510
- **Sentry** for trace explorer and HITL panels: dark purple-black, lime accent `#c2ef4e` for confidence scores
- **Supabase** for modals and overlays: HSL translucent layering

```
Phase 1 (exists)              Phase 7 (this design)
─────────────────             ─────────────────────
✓ Sidebar shell               → Add Observability nav link, user email
✓ Header                      → Add breadcrumbs
✓ Dashboard (placeholder)     → Live workspace cards, usage metrics, recent traces
✓ Workspaces list             → Already functional (keep)
✓ Workspace detail            → Enhance with drag-and-drop upload
✓ Workspace settings          → Already functional (keep)
✓ Trace detail                → Already functional (keep, minor enhancements)
✓ Traces list (placeholder)   → Full trace explorer with filters
✓ Auth callback               → Keep, add login page + auth guard
✗ HITL review                 → NEW: Review queue + correction interface
✗ Chat                        → NEW: Session list + conversation UI
✗ Observability               → NEW: Metrics dashboard
✗ Settings                    → NEW: Tenant profile + plan info
✗ Login page                  → NEW: Google OAuth button
✗ Auth guard                  → NEW: Route protection
✗ API client (partial)        → Extend with HITL, chat, observability methods
```

## Architecture

### File Structure

```
ui/src/
├── app/
│   ├── layout.tsx                          # UPDATE: Wrap with AuthProvider
│   ├── page.tsx                            # Keep (redirect to /dashboard)
│   ├── globals.css                         # Keep
│   ├── auth/
│   │   ├── login/page.tsx                  # NEW: Google OAuth login page
│   │   └── callback/page.tsx               # Keep (existing)
│   ├── dashboard/page.tsx                  # UPDATE: Live data from API
│   ├── workspaces/
│   │   ├── page.tsx                        # Keep (existing, functional)
│   │   └── [id]/
│   │       ├── page.tsx                    # UPDATE: Add drag-and-drop upload
│   │       └── settings/page.tsx           # Keep (existing, functional)
│   ├── traces/
│   │   ├── page.tsx                        # UPDATE: Full trace explorer with filters
│   │   └── [trace_id]/page.tsx             # Keep (existing, minor enhancements)
│   ├── hitl/
│   │   ├── page.tsx                        # NEW: Review queue
│   │   └── [trace_id]/page.tsx             # NEW: Review detail + correction UI
│   ├── chat/page.tsx                       # NEW: Chat interface
│   ├── observability/page.tsx              # NEW: Metrics dashboard
│   └── settings/page.tsx                   # NEW: Tenant profile + plan
├── components/
│   ├── Sidebar.tsx                         # UPDATE: Add Observability link, user email
│   ├── Header.tsx                          # UPDATE: Add breadcrumbs
│   ├── AuthProvider.tsx                    # NEW: Auth context + route guard
│   ├── AuthGuard.tsx                       # NEW: Redirect unauthenticated users
│   ├── StatusBadge.tsx                     # NEW: Reusable status pill
│   ├── ConfidenceIndicator.tsx             # NEW: Confidence bar + score
│   ├── DropZone.tsx                        # NEW: Drag-and-drop file upload
│   ├── Skeleton.tsx                        # NEW: Loading skeleton placeholders
│   ├── TimeRangeSelector.tsx               # NEW: Preset + custom date range
│   └── MetricCard.tsx                      # NEW: Reusable metric display card
└── lib/
    ├── amplify.ts                          # Keep (existing)
    └── api.ts                              # UPDATE: Add HITL, chat, observability methods
```

### Design System Token Mapping

Colors are already defined in `tailwind.config.ts`. Additional tokens for Sentry-styled panels:

```typescript
// Additional Tailwind colors for Sentry panels (add to tailwind.config.ts)
'sentry-bg': '#1a1025',           // Dark purple-black for trace/HITL panels
'sentry-surface': '#2a1f3d',      // Elevated surface in Sentry panels
'sentry-lime': '#c2ef4e',         // Lime accent for confidence scores
'sentry-lime-bg': 'rgba(194,239,78,0.1)', // Lime background tint
```

## Components and Interfaces

### 1. Auth Provider (`ui/src/components/AuthProvider.tsx`)

Client component that wraps the app, checks Amplify session, and provides auth context.

```typescript
'use client';

interface AuthContextValue {
  user: { email: string; tenantId: string; userId: string } | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({ user: null, loading: true, signOut: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // On mount: call getCurrentUser() from aws-amplify/auth
  // If authenticated: extract email, sub, custom:tenant_id from user attributes
  // If not authenticated: set user to null
  // Listen to Amplify Hub auth events for sign-in/sign-out
  // Provide { user, loading, signOut } via context
}

export function useAuth() {
  return useContext(AuthContext);
}
```

### 2. Auth Guard (`ui/src/components/AuthGuard.tsx`)

Client component that redirects unauthenticated users.

```typescript
'use client';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Public paths: /auth/login, /auth/callback
  // If loading: show full-screen spinner
  // If not authenticated and not on public path: redirect to /auth/login
  // If authenticated: render children
}
```

### 3. Layout Update (`ui/src/app/layout.tsx`)

Wrap the existing layout with AuthProvider and AuthGuard:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AuthGuard>
            <Sidebar />
            <main style={{ marginLeft: 'var(--sidebar-width)', minHeight: '100vh' }}>
              {children}
            </main>
          </AuthGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
```

### 4. Login Page (`ui/src/app/auth/login/page.tsx`)

Simple login page with Google OAuth button. No sidebar/header (standalone layout).

```typescript
// Renders outside the main layout (no sidebar)
// Centered card with DocOps logo, "Sign in with Google" button
// Button calls signInWithRedirect({ provider: 'Google' }) from aws-amplify/auth
// If user is already authenticated, redirect to /dashboard
```

### 5. API Client Extensions (`ui/src/lib/api.ts`)

Add methods for HITL, chat, and observability endpoints to the existing `api` object:

```typescript
// Add to existing api object:

hitl: {
  list: (params?: { workspace_id?: string; status?: string }) =>
    request<{ reviews: HitlReview[]; count: number }>('GET', `/v1/hitl${buildQuery(params)}`),
  get: (traceId: string) =>
    request<{ review: HitlReview; trace: Trace }>('GET', `/v1/hitl/${traceId}`),
  assign: (traceId: string, reviewer: string) =>
    request<HitlReview>('POST', `/v1/hitl/${traceId}/assign`, { reviewer }),
  submitCorrections: (traceId: string, corrections: Correction[]) =>
    request<HitlReview>('POST', `/v1/hitl/${traceId}/corrections`, { corrections }),
  resolve: (traceId: string) =>
    request<{ review: HitlReview }>('POST', `/v1/hitl/${traceId}/resolve`),
},

sessions: {
  create: (workspaceId: string, title?: string) =>
    request<Session>('POST', `/v1/workspaces/${workspaceId}/sessions`, { title }),
  list: (workspaceId: string) =>
    request<{ sessions: SessionSummary[]; count: number }>('GET', `/v1/workspaces/${workspaceId}/sessions`),
  get: (sessionId: string) =>
    request<Session>('GET', `/v1/sessions/${sessionId}`),
  delete: (sessionId: string) =>
    request<{ message: string }>('DELETE', `/v1/sessions/${sessionId}`),
  chat: (sessionId: string, message: string) =>
    request<ChatResponse>('POST', `/v1/sessions/${sessionId}/chat`, { message }),
},

observability: {
  dashboard: (params?: { workspace_id?: string; range?: string; start?: string; end?: string; group_by?: string; granularity?: string }) =>
    request<DashboardResponse>('GET', `/v1/observability${buildQuery(params)}`),
  traces: (params?: { workspace_id?: string; status?: string; range?: string; start?: string; end?: string }) =>
    request<{ traces: Trace[]; count: number; time_range: TimeRange }>('GET', `/v1/observability/traces${buildQuery(params)}`),
  agents: (params?: { workspace_id?: string; range?: string; start?: string; end?: string }) =>
    request<AgentMetricsResponse>('GET', `/v1/observability/agents${buildQuery(params)}`),
  usage: (params?: { range?: string; start?: string; end?: string }) =>
    request<UsageResponse>('GET', `/v1/observability/usage${buildQuery(params)}`),
},
```

New TypeScript interfaces to add:

```typescript
export interface HitlReview {
  trace_id: string;
  workspace_id: string;
  status: 'pending' | 'in_review' | 'resolved';
  reviewer?: string;
  corrections: Correction[];
  assigned_at?: string;
  resolved_at?: string;
  review_duration_ms?: number;
  correction_count?: number;
  created_at: string;
}

export interface Correction {
  field_name: string;
  original_value: unknown;
  corrected_value: unknown;
}

export interface Session {
  session_id: string;
  workspace_id: string;
  tenant_id: string;
  title: string;
  memory: MemoryEntry[];
  created_at: string;
}

export interface SessionSummary {
  session_id: string;
  workspace_id: string;
  title: string;
  message_count: number;
  created_at: string;
}

export interface MemoryEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatResponse {
  response: string;
  message_count: number;
  tokens: { input: number; output: number };
}

export interface DashboardResponse {
  dashboard: DashboardMetrics;
  hitl: HitlMetrics;
  error_analysis: ErrorGroup[];
  time_range: TimeRange;
  workspaces?: WorkspaceMetricsGroup[];
  time_series?: TimeSeriesBucket[];
}

export interface DashboardMetrics {
  total_traces: number;
  success_count: number;
  failure_count: number;
  hitl_required_count: number;
  success_rate: number;
  failure_rate: number;
  average_confidence: number;
  average_latency_ms: number;
  total_tokens: number;
}

export interface HitlMetrics {
  total_reviews: number;
  pending_count: number;
  in_review_count: number;
  resolved_count: number;
  average_review_duration_ms: number;
  average_correction_count: number;
}

export interface AgentMetric {
  agent_name: string;
  total_executions: number;
  success_count: number;
  error_count: number;
  average_latency_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  models: { model_id: string; execution_count: number; average_latency_ms: number }[];
}

export interface AgentMetricsResponse {
  agents: AgentMetric[];
  total_traces: number;
  time_range: TimeRange;
}

export interface ErrorGroup {
  error_message: string;
  count: number;
}

export interface TimeRange {
  start: string;
  end: string;
}

export interface TimeSeriesBucket {
  bucket_start: string;
  metrics: DashboardMetrics;
}

export interface WorkspaceMetricsGroup {
  workspace_id: string;
  workspace_name: string;
  metrics: DashboardMetrics;
}

export interface UsageResponse {
  usage: {
    total_documents_processed: number;
    total_tokens_consumed: number;
    workspace_count: number;
    active_sessions_count: number;
    plan: string;
    plan_limits: { docs_per_month: number; workspaces: number };
  };
  time_range: TimeRange;
}
```

Helper for building query strings:

```typescript
function buildQuery(params?: Record<string, string | undefined>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
}
```

### 6. Shared Components

#### StatusBadge (`ui/src/components/StatusBadge.tsx`)

Extracted from the inline implementation in the existing trace detail page. Reusable across all pages.

```typescript
interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#62666d',
  processing: '#f59e0b',
  completed: '#27a644',
  failed: '#ef4444',
  hitl_required: '#7170ff',
  in_review: '#f59e0b',
  resolved: '#27a644',
};

// Renders a pill with background tint and colored text
// size='sm' for list rows, size='md' for detail headers
```

#### ConfidenceIndicator (`ui/src/components/ConfidenceIndicator.tsx`)

Extracted from the existing `ConfidenceBar` in trace detail. Adds Sentry lime variant.

```typescript
interface ConfidenceIndicatorProps {
  value: number;          // 0.0 to 1.0
  variant?: 'default' | 'sentry';  // 'sentry' uses lime #c2ef4e
  showLabel?: boolean;
}

// 'default' variant: green >= 0.8, amber >= 0.5, red < 0.5
// 'sentry' variant: lime #c2ef4e for all values, opacity scales with confidence
// Renders a horizontal bar + percentage label
```

#### DropZone (`ui/src/components/DropZone.tsx`)

Drag-and-drop file upload component.

```typescript
interface DropZoneProps {
  onFile: (file: File) => void;
  accept?: string;          // e.g. ".pdf,.docx,.png,.jpg"
  disabled?: boolean;
  uploading?: boolean;
}

// Handles: dragenter, dragover, dragleave, drop events
// Visual states:
//   idle: dashed border, muted text "Drop a file or click to upload"
//   dragover: solid indigo border, indigo tint background
//   uploading: pulsing animation, "Uploading..." text
//   disabled: reduced opacity
// Also renders a hidden <input type="file"> triggered on click
```

#### Skeleton (`ui/src/components/Skeleton.tsx`)

Loading placeholder component.

```typescript
interface SkeletonProps {
  variant?: 'text' | 'card' | 'row';
  count?: number;
  className?: string;
}

// Renders animated pulse blocks matching the expected content layout
// 'text': single line shimmer
// 'card': rectangular card shimmer (for dashboard cards)
// 'row': list row shimmer (for trace/review lists)
```

#### TimeRangeSelector (`ui/src/components/TimeRangeSelector.tsx`)

Time range picker for observability dashboard.

```typescript
interface TimeRangeSelectorProps {
  value: { range?: string; start?: string; end?: string };
  onChange: (value: { range?: string; start?: string; end?: string }) => void;
}

// Preset buttons: 24h, 7d, 30d (highlighted when active)
// Custom range: two date inputs (start, end) that override presets
// Calls onChange when user selects a preset or changes custom dates
```

#### MetricCard (`ui/src/components/MetricCard.tsx`)

Reusable metric display card for dashboard and observability.

```typescript
interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

// Renders a card with label (muted), large value, optional subtitle
// Uses Linear panel styling: bg #0f1011, border rgba(255,255,255,0.06)
```

### 7. Dashboard Page Update (`ui/src/app/dashboard/page.tsx`)

Replace the static placeholder with live data.

```typescript
// Data fetching on mount:
// 1. api.workspaces.list() → workspace cards
// 2. api.observability.usage() → usage metrics (docs, tokens, plan)
// 3. api.observability.traces({ range: '7d' }) → recent traces (take first 5)

// Layout:
// - Usage stats row: 4 MetricCards (workspaces, docs processed, tokens, plan)
// - Workspace cards grid: clickable cards with name, doc count, last trace timestamp
// - Recent activity: 5 most recent traces with StatusBadge and ConfidenceIndicator
// - Quick actions: links to upload, traces, HITL, chat

// Loading: Skeleton placeholders for each section
// Errors: inline error per section, other sections still render
```

### 8. Trace Explorer Update (`ui/src/app/traces/page.tsx`)

Replace the placeholder with a full trace explorer.

```typescript
// State:
// - traces: Trace[]
// - statusFilter: string | undefined
// - workspaceFilter: string | undefined
// - workspaces: Workspace[] (for filter dropdown)

// On mount:
// 1. api.workspaces.list() → populate workspace filter dropdown
// 2. api.observability.traces() → initial trace list

// On filter change:
// - Re-fetch with api.observability.traces({ status, workspace_id })

// Layout:
// - Filter bar: status dropdown, workspace dropdown, trace count
// - Trace list: rows with trace_id, filename, workspace name, StatusBadge,
//   ConfidenceIndicator (sentry variant), timestamp
// - Click row → navigate to /traces/:trace_id

// Uses Sentry styling for the trace list panel:
// - Background: #1a1025 (sentry-bg)
// - Confidence scores: lime #c2ef4e
```

### 9. HITL Review Queue (`ui/src/app/hitl/page.tsx`)

New page for the review queue.

```typescript
// State:
// - reviews: HitlReview[]
// - statusFilter: string | undefined
// - workspaceFilter: string | undefined
// - statusCounts: { pending: number, in_review: number, resolved: number }

// On mount:
// 1. api.workspaces.list() → workspace filter dropdown
// 2. api.hitl.list() → review list

// On filter change:
// - Re-fetch with api.hitl.list({ status, workspace_id })

// Layout:
// - Status summary bar: 3 count pills (pending, in_review, resolved)
// - Filter bar: status dropdown, workspace dropdown
// - Review list: rows with trace_id, workspace name, StatusBadge, reviewer, timestamp
// - Click row → navigate to /hitl/:trace_id

// Uses Sentry styling for the review list panel
```

### 10. HITL Review Detail (`ui/src/app/hitl/[trace_id]/page.tsx`)

New page for reviewing and correcting a single trace.

```typescript
// State:
// - review: HitlReview | null
// - trace: Trace | null
// - corrections: Map<string, { original_value: unknown; corrected_value: string }>
// - submitting: boolean

// On mount:
// - api.hitl.get(trace_id) → { review, trace }

// Layout:
// - Review header: status badge, reviewer, timestamps
// - Action buttons (conditional on status):
//   - pending: "Assign to me" button
//   - in_review: "Submit corrections" + "Resolve" buttons
//   - resolved: read-only, show metrics
// - Fields table: each field row shows:
//   - field_name, current value, confidence (ConfidenceIndicator sentry variant)
//   - editable input for corrected value (enabled only when in_review)
// - Corrections list: previously submitted corrections
// - Resolution metrics (when resolved): duration, correction count

// Assign flow:
// 1. Click "Assign to me"
// 2. api.hitl.assign(trace_id, user.email)
// 3. Refresh review data

// Correction flow:
// 1. User edits field values in inputs
// 2. Click "Submit corrections"
// 3. Collect changed fields as Correction[]
// 4. api.hitl.submitCorrections(trace_id, corrections)
// 5. Refresh review data

// Resolve flow:
// 1. Click "Resolve"
// 2. api.hitl.resolve(trace_id)
// 3. Refresh review data, show metrics

// Error handling: display API errors inline, preserve unsaved corrections
```

### 11. Chat Interface (`ui/src/app/chat/page.tsx`)

New page for conversational document querying.

```typescript
// State:
// - selectedWorkspace: string | undefined
// - sessions: SessionSummary[]
// - activeSession: Session | null
// - message: string
// - sending: boolean

// Layout (two-panel):
// Left panel (narrow, 280px):
//   - Workspace selector dropdown
//   - "New chat" button
//   - Session list: title, message count, timestamp
//   - Delete button per session
// Right panel (main):
//   - Conversation thread: alternating user/assistant messages
//   - Message input bar at bottom: text input + send button
//   - Typing indicator while waiting for response

// Workspace selection:
// 1. api.workspaces.list() → populate dropdown
// 2. On select: api.sessions.list(workspaceId) → session list

// New chat:
// 1. api.sessions.create(workspaceId, title) → new session
// 2. Add to session list, select as active

// Select session:
// 1. api.sessions.get(sessionId) → full session with memory
// 2. Render memory as message thread

// Send message:
// 1. Append user message to thread immediately (optimistic)
// 2. Show typing indicator
// 3. api.sessions.chat(sessionId, message)
// 4. Append assistant response to thread
// 5. Show token usage below response
// 6. On error: show error inline, keep message in input

// Delete session:
// 1. Confirm dialog
// 2. api.sessions.delete(sessionId)
// 3. Remove from list, clear active if deleted

// Message styling:
// - User messages: right-aligned, indigo accent background
// - Assistant messages: left-aligned, panel background
// - Timestamps: muted text below each message
```

### 12. Observability Dashboard (`ui/src/app/observability/page.tsx`)

New page for metrics and monitoring.

```typescript
// State:
// - dashboard: DashboardResponse | null
// - agentMetrics: AgentMetricsResponse | null
// - usage: UsageResponse | null
// - timeRange: { range?: string; start?: string; end?: string }
// - workspaceFilter: string | undefined
// - groupByWorkspace: boolean

// On mount:
// 1. api.observability.dashboard({ range: '7d' })
// 2. api.observability.agents({ range: '7d' })
// 3. api.observability.usage({ range: '7d' })
// 4. api.workspaces.list() → workspace filter dropdown

// On time range change:
// - Re-fetch all three endpoints with new params

// On workspace filter change:
// - Re-fetch dashboard and agents with workspace_id

// Layout:
// - TimeRangeSelector + workspace filter dropdown
// - Summary row: 6 MetricCards (total traces, success rate, failure rate,
//   avg confidence, avg latency, total tokens)
// - HITL metrics row: 4 MetricCards (total reviews, pending, avg duration, avg corrections)
// - Agent performance section: card per agent with execution count, success rate,
//   avg latency, token usage, model breakdown
// - Error analysis section: table of top errors with count
// - Usage section: docs processed, tokens consumed, plan limits with progress bars
// - Workspace breakdown (when group_by=workspace): table with per-workspace metrics

// All sections use Skeleton loading states
// Errors are scoped per section
```

### 13. Settings Page (`ui/src/app/settings/page.tsx`)

New page for tenant profile and plan info.

```typescript
// On mount:
// 1. useAuth() → user email, tenant ID
// 2. api.observability.usage() → plan info and current usage

// Layout:
// - Profile section: email, tenant ID (read-only)
// - Plan section: plan name, limits (workspaces, docs/month)
// - Usage section: current usage vs limits with progress bars
// - API section: API endpoint URL (from env), copy button
// - Sign out button

// Uses Linear panel styling
```

### 14. Sidebar Update (`ui/src/components/Sidebar.tsx`)

Add Observability nav link and user email display.

```typescript
// Changes:
// 1. Add { href: '/observability', label: 'Observability', icon: '◈' } to NAV_ITEMS
// 2. Update footer to show user email from useAuth() context
// 3. Update "Phase 1 · Foundation" text to "Phase 7 · Full UI"
```

### 15. Header Update (`ui/src/components/Header.tsx`)

Add breadcrumb support.

```typescript
interface HeaderProps {
  title: string;
  breadcrumbs?: { label: string; href: string }[];
}

// Renders breadcrumbs as: Home > Workspaces > Invoice Processing > Settings
// Each breadcrumb except the last is a link
// Last breadcrumb is the current page title (not a link)
```

### 16. Workspace Detail Update (`ui/src/app/workspaces/[id]/page.tsx`)

Replace the basic file input with the DropZone component.

```typescript
// Changes:
// 1. Replace <input type="file"> with <DropZone> component
// 2. DropZone handles drag-and-drop + click-to-upload
// 3. Keep existing file-to-base64 conversion logic
// 4. Add processing status tracking: show trace status updates after upload
```

## Data Models

### Client-Side State

No global state management library needed. Each page manages its own state with `useState`/`useEffect`. The only shared state is the auth context (user info) provided by `AuthProvider`.

### API Response Type Mapping

All API response types are defined in `ui/src/lib/api.ts` (see Section 5 above). They mirror the backend response shapes from the Phase 1–6 design documents.

### Local Storage

No local storage is used. All data is fetched from the API on each page load. Amplify manages auth tokens in its own storage.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do.*

### Property 1: Auth guard redirects unauthenticated users to login

*For any* route that is not `/auth/login` or `/auth/callback`, if no valid Amplify session exists, the Auth_Guard should redirect to `/auth/login`. No protected page content should render for unauthenticated users.

**Validates: Requirements 11.3, 11.4**

### Property 2: API client attaches Bearer token to all authenticated requests

*For any* API request made through the API_Client, the `Authorization` header should contain `Bearer {token}` where the token is a valid Cognito ID token from the current Amplify session. Requests to public endpoints (health) may omit the token.

**Validates: Requirements 13.4, 13.5**

### Property 3: Status badge color mapping is consistent across all pages

*For any* trace status value, the StatusBadge component should render the same color regardless of which page it appears on. The mapping is: pending→gray, processing→amber, completed→green, failed→red, hitl_required→indigo, in_review→amber, resolved→green.

**Validates: Requirements 12.3**

### Property 4: Confidence indicator color thresholds are consistent

*For any* confidence value between 0.0 and 1.0, the ConfidenceIndicator in default variant should render green for >= 0.8, amber for >= 0.5, and red for < 0.5. In sentry variant, it should render lime (#c2ef4e) with opacity proportional to the value.

**Validates: Requirements 12.4**

### Property 5: HITL correction submission preserves all changed fields

*For any* set of field edits made by a reviewer in the HITL review detail view, the corrections array submitted to the API should contain exactly one Correction object for each field whose value was changed, with the correct `field_name`, `original_value`, and `corrected_value`.

**Validates: Requirements 7.5**

### Property 6: Chat message ordering is preserved

*For any* chat session, the messages displayed in the conversation thread should appear in the same order as the `memory` array from the API response. User and assistant messages should alternate, with the most recent message at the bottom.

**Validates: Requirements 8.3, 8.4**

### Property 7: Dashboard sections render independently on partial API failure

*For any* combination of API failures on the dashboard page, sections whose data loaded successfully should render normally. Only sections whose API call failed should show an error message.

**Validates: Requirements 1.7, 9.9**

### Property 8: Filter changes trigger API re-fetch with correct parameters

*For any* filter change on the trace explorer, HITL queue, or observability dashboard, the subsequent API call should include the selected filter values as query parameters. Clearing a filter should remove that parameter from the request.

**Validates: Requirements 4.3, 4.5, 6.3, 9.3**

### Property 9: DropZone accepts only supported file types

*For any* file dropped on or selected through the DropZone component, the component should only process files with extensions matching the `accept` prop (PDF, DOCX, PNG, JPG). Files with unsupported extensions should be rejected without making an API call.

**Validates: Requirements 3.1**

### Property 10: Optimistic chat message display followed by server confirmation

*For any* chat message sent by the user, the user message should appear in the thread immediately before the API response arrives. If the API call fails, the user message should remain visible and an error should be shown, but the assistant message should not appear.

**Validates: Requirements 8.5, 8.8**

## Error Handling

### Error Categories

| Error Type | Source | User-Facing Behavior |
|-----------|--------|---------------------|
| 401 Unauthorized | Expired/missing token | Redirect to `/auth/login` |
| 403 Forbidden | Wrong tenant | Display "Access denied" message |
| 404 Not Found | Invalid resource ID | Display "Not found" message |
| 409 Conflict | Invalid HITL status transition | Display specific conflict message from API |
| 429 Too Many Requests | Plan limit exceeded | Display upgrade prompt with plan limits |
| 500 Server Error | Backend failure | Display "Something went wrong" with retry option |
| 502 Bad Gateway | Bedrock/LLM failure | Display "AI service unavailable" in chat |
| Network Error | No connectivity | Display "Network error, check your connection" |

### Error Handling Strategy

- The `request()` function in `api.ts` throws errors with the message from the API response body
- Each page catches errors in its data-fetching logic and sets error state per section
- 401 errors trigger a redirect to login (handled in the API client)
- All error messages are displayed inline in the affected section, not as global alerts
- HITL correction form preserves unsaved edits when API errors occur
- Chat interface preserves the message input text when send fails

## Testing Strategy

### Component Testing

Use React Testing Library with Vitest for component-level tests:

- **AuthGuard**: Verify redirect behavior for unauthenticated users, verify rendering for authenticated users
- **StatusBadge**: Verify correct color for each status value
- **ConfidenceIndicator**: Verify color thresholds and sentry variant
- **DropZone**: Verify drag-and-drop events, file type filtering, disabled state
- **TimeRangeSelector**: Verify preset selection, custom date input, onChange callbacks

### Page Integration Testing

Mock the API client and test page behavior:

- **Dashboard**: Verify data fetching on mount, skeleton loading, error handling per section
- **Trace Explorer**: Verify filter changes trigger re-fetch, trace list rendering
- **HITL Queue**: Verify status filter, review list rendering
- **HITL Detail**: Verify assign/correct/resolve workflow, error preservation
- **Chat**: Verify session creation, message send/receive, optimistic updates
- **Observability**: Verify time range changes, workspace filter, metric card rendering
- **Settings**: Verify user info display, usage progress bars

### Test Organization

```
ui/src/__tests__/
├── components/
│   ├── StatusBadge.test.tsx
│   ├── ConfidenceIndicator.test.tsx
│   ├── DropZone.test.tsx
│   ├── TimeRangeSelector.test.tsx
│   ├── AuthGuard.test.tsx
│   └── MetricCard.test.tsx
├── pages/
│   ├── dashboard.test.tsx
│   ├── traces.test.tsx
│   ├── hitl-queue.test.tsx
│   ├── hitl-detail.test.tsx
│   ├── chat.test.tsx
│   ├── observability.test.tsx
│   └── settings.test.tsx
└── lib/
    └── api.test.ts
```

### Dependencies

- `@testing-library/react` — React component testing
- `@testing-library/user-event` — User interaction simulation
- `vitest` — Test runner
- `msw` — API mocking for integration tests
