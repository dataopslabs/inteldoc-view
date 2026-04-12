import { ApiRequest, ApiResponse } from '../models/types';
// T1-03: Use top-level imports only — removed dynamic import anti-pattern
import { getItem, queryIndexPaginated, TABLE_NAMES } from '../lib/dynamo';

interface Trace {
  trace_id: string;
  workspace_id: string;
  tenant_id: string;
  status: string;
  confidence?: string;
  tokens?: number;
  latency?: string;
  agent_steps?: string[];
  fields?: unknown[];
  hitl_required?: boolean;
  filename?: string;
  prompt_version: string;
  created_at: string;
  error?: string;
}

export async function handleGetTrace(req: ApiRequest): Promise<ApiResponse> {
  const { trace_id } = req.pathParams;
  const tenant = req.context.tenant!;

  const trace = await getItem<Trace>(TABLE_NAMES.traces, { trace_id });
  if (!trace) {
    return { statusCode: 404, body: { error: 'Trace not found' } };
  }
  if (trace.tenant_id !== tenant.tenant_id) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }

  return { statusCode: 200, body: trace };
}

export async function handleListTraces(req: ApiRequest): Promise<ApiResponse> {
  const { id: workspaceId } = req.pathParams;
  const tenant = req.context.tenant!;

  // T1-03: Use top-level imported getItem — no dynamic import needed
  const workspace = await getItem<{ tenant_id: string }>(TABLE_NAMES.workspaces, { workspace_id: workspaceId });
  if (!workspace) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }
  if (workspace.tenant_id !== tenant.tenant_id) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }

  // T1-02: Paginated query — accept limit and next_token query params
  const limit = Math.min(parseInt(req.queryParams?.limit ?? '50', 10) || 50, 100);
  const nextToken = req.queryParams?.next_token;

  const result = await queryIndexPaginated<Trace>(
    TABLE_NAMES.traces,
    'workspace-index',
    'workspace_id',
    workspaceId,
    limit,
    nextToken
  );

  // T2-08: Sort newest first within the current page
  const sorted = [...result.items].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    statusCode: 200,
    body: {
      traces: sorted,
      count: sorted.length,
      ...(result.nextToken ? { next_token: result.nextToken } : {}),
    },
  };
}
