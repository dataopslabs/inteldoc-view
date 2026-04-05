import { fetchAuthSession } from 'aws-amplify/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

async function getToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession();
    return session.tokens?.idToken?.toString() ?? null;
  } catch {
    return null;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface Workspace {
  workspace_id: string;
  tenant_id: string;
  name: string;
  description?: string;
  prompt_version: string;
  hitl_threshold: number;
  schema?: Record<string, unknown>;
  created_at: string;
}

export interface FieldResult {
  field: string;
  docling_value: unknown;
  llm_value: unknown;
  final_value: unknown;
  confidence: number;
  conflict: boolean;
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface Trace {
  trace_id: string;
  workspace_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'hitl_required';
  workflow_state?: string;
  workflow_steps?: { from: string; to: string; at: string; meta?: Record<string, unknown> }[];
  confidence?: string;
  tokens?: number;
  latency?: string;
  agent_steps?: string[];
  fields?: FieldResult[];
  hitl_required?: boolean;
  validation_errors?: ValidationError[];
  validation_warnings?: string[];
  filename?: string;
  prompt_version: string;
  created_at: string;
  error?: string;
}

export const api = {
  health: () => request<{ status: string }>('GET', '/v1/health'),
  workspaces: {
    list: () => request<{ workspaces: Workspace[]; count: number }>('GET', '/v1/workspaces'),
    get: (id: string) => request<Workspace>('GET', `/v1/workspaces/${id}`),
    create: (data: { name: string; description?: string; hitl_threshold?: number }) =>
      request<Workspace>('POST', '/v1/workspaces', data),
    update: (
      id: string,
      data: {
        name?: string;
        description?: string;
        schema?: Record<string, unknown>;
        hitl_threshold?: number;
        prompt_version?: string;
        agents?: string[];
      }
    ) => request<Workspace>('PUT', `/v1/workspaces/${id}`, data),
  },
  traces: {
    list: (workspaceId: string) =>
      request<{ traces: Trace[]; count: number }>('GET', `/v1/workspaces/${workspaceId}/traces`),
    get: (traceId: string) => request<Trace>('GET', `/v1/traces/${traceId}`),
  },
  process: (workspaceId: string, data: { filename: string; content_base64: string }) =>
    request<{ trace_id: string; status: string; message: string }>(
      'POST',
      `/v1/workspaces/${workspaceId}/process`,
      data
    ),
};
