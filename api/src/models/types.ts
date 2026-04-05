export type Plan = 'free' | 'pro' | 'enterprise';

export interface Tenant {
  tenant_id: string;
  email: string;
  plan: Plan;
  created_at: string;
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
}

export interface Trace {
  trace_id: string;
  workspace_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'hitl_required';
  confidence?: number;
  tokens?: number;
  latency?: number;
  agent_steps?: unknown[];
  prompt_version: string;
  created_at: string;
}

export interface Session {
  session_id: string;
  workspace_id: string;
  memory: unknown[];
  created_at: string;
}

export interface HitlReview {
  trace_id: string;
  status: 'pending' | 'in_review' | 'resolved';
  reviewer?: string;
  corrections?: unknown[];
  resolved_at?: string;
  created_at: string;
}

export const PLAN_LIMITS: Record<Plan, { workspaces: number; docs_per_month: number }> = {
  free: { workspaces: 2, docs_per_month: 10 },
  pro: { workspaces: 20, docs_per_month: 500 },
  enterprise: { workspaces: Infinity, docs_per_month: Infinity },
};

export interface RequestContext {
  tenantId: string;
  userId: string;
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
