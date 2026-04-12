import crypto from 'crypto';
import { ApiRequest, ApiResponse, Session, Workspace } from '../models/types';
import { getItem, putItem, queryIndex, TABLE_NAMES, docClient, DeleteCommand } from '../lib/dynamo';

/**
 * Helper: verify tenant owns the workspace.
 * Returns the workspace if owned, or an ApiResponse error if not.
 */
async function verifyWorkspaceOwnership(
  workspaceId: string,
  tenantId: string
): Promise<Workspace | ApiResponse> {
  const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: workspaceId });
  if (!workspace) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }
  if (workspace.tenant_id !== tenantId) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }
  return workspace;
}

function isErrorResponse(result: unknown): result is ApiResponse {
  return typeof result === 'object' && result !== null && 'statusCode' in result;
}

/**
 * POST /v1/workspaces/:id/sessions
 * Body: { title?: string }
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */
export async function handleCreateSession(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const workspaceId = req.pathParams.id;

  const ownershipResult = await verifyWorkspaceOwnership(workspaceId, tenant.tenant_id);
  if (isErrorResponse(ownershipResult)) {
    return ownershipResult;
  }

  const body = req.body as { title?: string } | undefined;

  // expires_at: 30 days from now (Unix epoch seconds) — used by DynamoDB TTL
  const SESSION_TTL_SECONDS = 30 * 24 * 3600;
  const session: Session = {
    session_id: crypto.randomUUID(),
    workspace_id: workspaceId,
    tenant_id: tenant.tenant_id,
    title: body?.title || 'New Chat',
    memory: [],
    created_at: new Date().toISOString(),
  };

  await putItem(TABLE_NAMES.sessions, {
    ...(session as unknown as Record<string, unknown>),
    expires_at: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  });
  return { statusCode: 201, body: session };
}

/**
 * GET /v1/workspaces/:id/sessions
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */
export async function handleListSessions(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const workspaceId = req.pathParams.id;

  const ownershipResult = await verifyWorkspaceOwnership(workspaceId, tenant.tenant_id);
  if (isErrorResponse(ownershipResult)) {
    return ownershipResult;
  }

  const sessions = await queryIndex<Session>(
    TABLE_NAMES.sessions,
    'workspace-index',
    'workspace_id',
    workspaceId
  );

  // Sort by created_at descending (newest first)
  sessions.sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Map to summaries — exclude full memory, include message_count
  const summaries = sessions.map(s => ({
    session_id: s.session_id,
    workspace_id: s.workspace_id,
    title: s.title,
    created_at: s.created_at,
    message_count: s.memory.length,
  }));

  return { statusCode: 200, body: { sessions: summaries, count: summaries.length } };
}

/**
 * GET /v1/sessions/:id
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export async function handleGetSession(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const sessionId = req.pathParams.id;

  const session = await getItem<Session>(TABLE_NAMES.sessions, { session_id: sessionId });
  if (!session) {
    return { statusCode: 404, body: { error: 'Session not found' } };
  }

  const ownershipResult = await verifyWorkspaceOwnership(session.workspace_id, tenant.tenant_id);
  if (isErrorResponse(ownershipResult)) {
    return ownershipResult;
  }

  return { statusCode: 200, body: session };
}

/**
 * DELETE /v1/sessions/:id
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */
export async function handleDeleteSession(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const sessionId = req.pathParams.id;

  const session = await getItem<Session>(TABLE_NAMES.sessions, { session_id: sessionId });
  if (!session) {
    return { statusCode: 404, body: { error: 'Session not found' } };
  }

  const ownershipResult = await verifyWorkspaceOwnership(session.workspace_id, tenant.tenant_id);
  if (isErrorResponse(ownershipResult)) {
    return ownershipResult;
  }

  await docClient.send(new DeleteCommand({
    TableName: TABLE_NAMES.sessions,
    Key: { session_id: sessionId },
  }));

  return { statusCode: 200, body: { message: 'Session deleted' } };
}
