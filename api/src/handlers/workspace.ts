import { v4 as uuidv4 } from 'uuid';
import { ApiRequest, ApiResponse, Workspace } from '../models/types';
import { getItem, putItem, queryIndex, TABLE_NAMES, docClient, UpdateCommand } from '../lib/dynamo';
import { enforceWorkspaceLimit } from '../middleware/plan-enforcer';

export async function handleCreateWorkspace(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const check = await enforceWorkspaceLimit(tenant);
  if (!check.allowed) {
    return { statusCode: 429, body: { error: check.message } };
  }

  const body = req.body as { name?: string; description?: string; hitl_threshold?: number };
  if (!body?.name) {
    return { statusCode: 400, body: { error: 'name is required' } };
  }

  const workspace: Workspace = {
    workspace_id: uuidv4(),
    tenant_id: tenant.tenant_id,
    name: body.name,
    description: body.description,
    prompt_version: '1.0.0',
    agents: [],
    hitl_threshold: body.hitl_threshold ?? 0.8,
    created_at: new Date().toISOString(),
  };

  await putItem(TABLE_NAMES.workspaces, workspace as unknown as Record<string, unknown>);
  return { statusCode: 201, body: workspace };
}

export async function handleListWorkspaces(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const workspaces = await queryIndex<Workspace>(
    TABLE_NAMES.workspaces,
    'tenant-index',
    'tenant_id',
    tenant.tenant_id
  );
  return { statusCode: 200, body: { workspaces, count: workspaces.length } };
}

export async function handleGetWorkspace(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const { id } = req.pathParams;
  const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: id });

  if (!workspace) {
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

  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAMES.workspaces,
    Key: { workspace_id: id },
    UpdateExpression: `SET ${exprParts.join(', ')}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));

  const updated = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: id });
  return { statusCode: 200, body: updated };
}
