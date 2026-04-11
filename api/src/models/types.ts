export type Plan = 'free' | 'pro' | 'enterprise';

export interface PlanLimits {
  workspaces: number;
  docs_per_month: number;
  tokens_per_month: number;
  chats_per_month: number;
}

export interface Tenant {
  tenant_id: string;
  email: string;
  plan: Plan;
  created_at: string;
  previous_plan?: Plan;
  downgrade_at?: string;
  admin_override_limits?: PlanLimits;
}

export interface UsageRecord {
  tenant_id: string;
  billing_period: string;
  documents: number;
  tokens: number;
  chats: number;
  updated_at: string;
}

export interface UsageEvent {
  event_id: string;
  tenant_id: string;
  event_type: 'document_processed' | 'tokens_consumed' | 'chat_message';
  quantity: number;
  billing_period: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export type ResourceType = 'documents' | 'tokens' | 'chats' | 'workspaces';

export interface EnforcementResult {
  allowed: boolean;
  warnings: Array<{
    resource_type: ResourceType;
    current_usage: number;
    limit: number;
    header_name: string;
    header_value: string;
  }>;
  rejection?: {
    resource_type: ResourceType;
    current_usage: number;
    limit: number;
    billing_period: string;
    upgrade_url: string;
    message: string;
  };
  remaining?: Record<ResourceType, number>;
}

export interface Workspace {
  workspace_id: string;
  tenant_id: string;
  name: string;
  description?: string;
  prompt_version: string;
  schema?: Record<string, unknown>;
  agents?: string[];
  hitl_threshold: number;
  created_at: string;
  updated_at?: string;  // G6-15: stamped on every create/update/delete
}

export type UserRole = 'admin' | 'editor' | 'reviewer' | 'viewer';

export interface Trace {
  trace_id: string;
  workspace_id: string;
  tenant_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'hitl_required';
  confidence?: number;
  tokens?: number;
  latency?: number;
  agent_steps?: unknown[];
  error?: string;
  error_code?: string;
  prompt_version: string;
  created_at: string;
}

export interface MemoryEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ChatRequest {
  message: string;
}

export interface ChatResponse {
  response: string;
  message_count: number;
  tokens: {
    input: number;
    output: number;
  };
}

export interface Session {
  session_id: string;
  workspace_id: string;
  tenant_id: string;
  title: string;
  memory: MemoryEntry[];
  created_at: string;
}

export interface Correction {
  field_name: string;
  original_value: unknown;
  corrected_value: unknown;
}

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

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { workspaces: 2, docs_per_month: 10, tokens_per_month: 100_000, chats_per_month: 50 },
  pro: { workspaces: 20, docs_per_month: 500, tokens_per_month: 5_000_000, chats_per_month: 2000 },
  enterprise: { workspaces: Infinity, docs_per_month: Infinity, tokens_per_month: Infinity, chats_per_month: Infinity },
};

export interface RequestContext {
  tenantId: string;
  userId: string;
  role?: UserRole;
  tenant?: Tenant;
}

export interface ApiRequest {
  method: string;
  path: string;
  pathParams: Record<string, string>;
  queryParams: Record<string, string>;
  body: unknown;
  context: RequestContext;
  headers: Record<string, string>;
}

export interface ApiResponse {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
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

export interface AgentMetrics {
  agent_name: string;
  total_executions: number;
  success_count: number;
  error_count: number;
  average_latency_ms: number;
  total_input_tokens: number;
  total_output_tokens: number;
  models: Array<{ model_id: string; execution_count: number; average_latency_ms: number }>;
}

export interface ErrorGroup {
  error_message: string;
  count: number;
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

export interface UsageSummary {
  total_documents_processed: number;
  total_tokens_consumed: number;
  workspace_count: number;
  active_sessions_count: number;
  plan: string;
  plan_limits: PlanLimits;
}
