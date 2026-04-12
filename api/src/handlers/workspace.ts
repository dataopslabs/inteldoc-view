import { v4 as uuidv4 } from 'uuid';
import { ApiRequest, ApiResponse, Workspace } from '../models/types';
import { getItem, putItem, queryIndex, queryIndexPaginated, deleteItem, TABLE_NAMES, docClient, UpdateCommand } from '../lib/dynamo';
import { auditLog } from '../lib/audit-logger';

// T4-10: Structured logging helper — all workspace handler logs emit parseable JSON
// for CloudWatch Logs Insights queries.
function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, ctx: Record<string, unknown> = {}): void {
  console[level === 'INFO' ? 'log' : level === 'WARN' ? 'warn' : 'error'](
    JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...ctx })
  );
}

const VALID_AGENT_NAMES = new Set(['parsing', 'extraction', 'validation', 'reconciliation']);

const MAX_NAME_LEN = 100;
const MAX_DESC_LEN = 500;

function validateAgentNames(agents: unknown[]): string | null {
  for (const agent of agents) {
    const name = typeof agent === 'string' ? agent : (agent as any)?.agent_name;
    if (!name || !VALID_AGENT_NAMES.has(name)) {
      return `Unrecognized agent name: '${name}'. Valid agents: ${[...VALID_AGENT_NAMES].join(', ')}`;
    }
  }
  return null;
}

function validateWorkspaceFields(
  name?: string,
  description?: string,
  hitlThreshold?: number
): string | null {
  if (name !== undefined) {
    if (!name.trim()) return 'name cannot be empty';
    if (name.length > MAX_NAME_LEN) return `name must be ${MAX_NAME_LEN} characters or fewer`;
  }
  if (description !== undefined && description.length > MAX_DESC_LEN) {
    return `description must be ${MAX_DESC_LEN} characters or fewer`;
  }
  if (hitlThreshold !== undefined) {
    if (typeof hitlThreshold !== 'number' || isNaN(hitlThreshold)) {
      return 'hitl_threshold must be a number';
    }
    if (hitlThreshold < 0 || hitlThreshold > 1) {
      return 'hitl_threshold must be between 0 and 1 inclusive';
    }
  }
  return null;
}

export async function handleCreateWorkspace(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;

  const body = req.body as { name?: string; description?: string; hitl_threshold?: number; agents?: unknown[]; schema?: Record<string, unknown> };
  if (!body?.name) {
    return { statusCode: 400, body: { error: 'name is required' } };
  }

  const fieldError = validateWorkspaceFields(body.name, body.description, body.hitl_threshold);
  if (fieldError) {
    return { statusCode: 400, body: { error: fieldError } };
  }

  if (body.agents && Array.isArray(body.agents)) {
    const agentError = validateAgentNames(body.agents);
    if (agentError) {
      return { statusCode: 400, body: { error: agentError } };
    }
  }

  const now = new Date().toISOString();
  const workspace: Workspace = {
    workspace_id: uuidv4(),
    tenant_id: tenant.tenant_id,
    name: body.name.trim(),
    description: body.description,
    prompt_version: '1.0.0',
    agents: [],
    hitl_threshold: body.hitl_threshold ?? 0.8,
    ...(body.schema ? { schema: body.schema } : {}),
    created_at: now,
    updated_at: now,
  };

  await putItem(TABLE_NAMES.workspaces, workspace as unknown as Record<string, unknown>);
  log('INFO', 'Workspace created', { workspace_id: workspace.workspace_id, tenant_id: tenant.tenant_id, name: workspace.name });

  // G6-14: Audit workspace creation
  auditLog(tenant.tenant_id, req.context.userId, 'workspace.created', {
    resourceId: workspace.workspace_id,
    metadata: { name: workspace.name },
  }).catch(() => {});

  return { statusCode: 201, body: workspace };
}

export async function handleListWorkspaces(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  // T1-02: Accept pagination params; default limit 50, max 100
  const limit = Math.min(parseInt(req.queryParams?.limit ?? '50', 10) || 50, 100);
  const nextToken = req.queryParams?.next_token;

  const result = await queryIndexPaginated<Workspace>(
    TABLE_NAMES.workspaces,
    'tenant-index',
    'tenant_id',
    tenant.tenant_id,
    limit,
    nextToken
  );

  // T3-04: Filter out soft-deleted workspaces
  const active = result.items.filter(ws => !(ws as any).deleted_at);

  return {
    statusCode: 200,
    body: {
      workspaces: active,
      count: active.length,
      ...(result.nextToken ? { next_token: result.nextToken } : {}),
    },
  };
}

export async function handleGetWorkspace(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const { id } = req.pathParams;
  const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: id });

  if (!workspace) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }
  // T3-04: Treat soft-deleted workspaces as not found
  if ((workspace as any).deleted_at) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }
  if (workspace.tenant_id !== tenant.tenant_id) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }

  return { statusCode: 200, body: workspace };
}

export async function handleUpdateWorkspace(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const { id } = req.pathParams;

  const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: id });
  if (!workspace) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }
  if ((workspace as any).deleted_at) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }
  if (workspace.tenant_id !== tenant.tenant_id) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }

  const body = req.body as {
    name?: string;
    description?: string;
    schema?: Record<string, unknown>;
    hitl_threshold?: number;
    prompt_version?: string;
    agents?: string[];
  };

  if (!body || Object.keys(body).length === 0) {
    return { statusCode: 400, body: { error: 'No fields to update' } };
  }

  const fieldError = validateWorkspaceFields(body.name, body.description, body.hitl_threshold);
  if (fieldError) {
    return { statusCode: 400, body: { error: fieldError } };
  }

  if (body.agents && Array.isArray(body.agents)) {
    const agentError = validateAgentNames(body.agents);
    if (agentError) {
      return { statusCode: 400, body: { error: agentError } };
    }
  }

  const allowed = ['name', 'description', 'schema', 'hitl_threshold', 'prompt_version', 'agents'] as const;
  const exprParts: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  let i = 0;

  for (const key of allowed) {
    if (body[key] !== undefined) {
      names[`#f${i}`] = key;
      values[`:v${i}`] = body[key];
      exprParts.push(`#f${i} = :v${i}`);
      i++;
    }
  }

  // G6-15: Always stamp updated_at on every update
  names['#ua'] = 'updated_at';
  values[':ua'] = new Date().toISOString();
  exprParts.push('#ua = :ua');

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAMES.workspaces,
    Key: { workspace_id: id },
    UpdateExpression: `SET ${exprParts.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));

  // G6-14: Audit workspace update
  auditLog(tenant.tenant_id, req.context.userId, 'workspace.updated', {
    resourceId: id,
    metadata: { fields: Object.keys(body).filter(k => (body as Record<string, unknown>)[k] !== undefined) },
  }).catch(() => {});

  const updated = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: id });
  return { statusCode: 200, body: updated };
}

/**
 * T3-04: Soft delete — sets deleted_at timestamp instead of hard-deleting.
 * Preserves all trace data for audit compliance and disaster recovery.
 * A background cleanup job (or TTL policy) can purge permanently after 30 days.
 */
export async function handleDeleteWorkspace(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const { id } = req.pathParams;

  const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: id });
  if (!workspace) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }
  if ((workspace as any).deleted_at) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }
  if (workspace.tenant_id !== tenant.tenant_id) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }

  const deletedAt = new Date().toISOString();
  log('INFO', 'Workspace soft-deleted', { workspace_id: id, tenant_id: tenant.tenant_id });

  // Soft delete: mark with deleted_at timestamp — preserves all traces and audit trail
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAMES.workspaces,
    Key: { workspace_id: id },
    UpdateExpression: 'SET #deleted_at = :now, #ua = :now',
    ExpressionAttributeNames: { '#deleted_at': 'deleted_at', '#ua': 'updated_at' },
    ExpressionAttributeValues: { ':now': deletedAt },
  }));

  // G6-14: Audit workspace deletion
  auditLog(tenant.tenant_id, req.context.userId, 'workspace.deleted', {
    resourceId: id,
    metadata: { name: workspace.name },
  }).catch(() => {});

  // T4-12: Cascading soft-delete — mark all child sessions and traces with archived_workspace_id
  // so they are excluded from active workspace queries. Done asynchronously after the workspace
  // is already soft-deleted (best-effort); any missed items will be filtered by the workspace
  // deleted_at check in their respective read handlers.
  setImmediate(async () => {
    try {
      // Archive sessions belonging to this workspace
      const sessions = await queryIndex(TABLE_NAMES.sessions, 'workspace-index', 'workspace_id', id);
      await Promise.allSettled(
        sessions.map((s: any) =>
          docClient.send(new UpdateCommand({
            TableName: TABLE_NAMES.sessions,
            Key: { session_id: s.session_id },
            UpdateExpression: 'SET #archived = :workspace_id',
            ExpressionAttributeNames: { '#archived': 'archived_workspace_id' },
            ExpressionAttributeValues: { ':workspace_id': id },
          }))
        )
      );

      // Archive traces belonging to this workspace
      const traces = await queryIndex(TABLE_NAMES.traces, 'workspace-index', 'workspace_id', id);
      await Promise.allSettled(
        traces.map((t: any) =>
          docClient.send(new UpdateCommand({
            TableName: TABLE_NAMES.traces,
            Key: { trace_id: t.trace_id },
            UpdateExpression: 'SET #archived = :workspace_id',
            ExpressionAttributeNames: { '#archived': 'archived_workspace_id' },
            ExpressionAttributeValues: { ':workspace_id': id },
          }))
        )
      );
    } catch {
      // Best-effort: log only; workspace is already soft-deleted
      console.error(JSON.stringify({
        level: 'ERROR',
        message: 'Cascading workspace cleanup failed (best-effort)',
        workspace_id: id,
        timestamp: new Date().toISOString(),
      }));
    }
  });

  return { statusCode: 204, body: null };
}
