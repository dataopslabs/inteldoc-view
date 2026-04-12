import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { handleCreateSession, handleListSessions, handleGetSession, handleDeleteSession } from '../handlers/sessions';
import { ApiRequest } from '../models/types';

const ddbMock = mockClient(DynamoDBDocumentClient);

const SESSIONS_TABLE = process.env.SESSIONS_TABLE ?? 'docops-sessions';
const WORKSPACES_TABLE = process.env.WORKSPACES_TABLE ?? 'docops-workspaces';

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    path: '/v1/workspaces/ws-1/sessions',
    pathParams: {},
    queryParams: {},
    body: null,
    headers: {},
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      tenant: { tenant_id: 'tenant-1', email: 'test@test.com', plan: 'pro', created_at: '2024-01-01' },
    },
    ...overrides,
  };
}

const sampleWorkspace = {
  workspace_id: 'ws-1',
  tenant_id: 'tenant-1',
  name: 'Test Workspace',
  prompt_version: 'v1',
  hitl_threshold: 0.8,
  created_at: '2024-01-01T00:00:00Z',
};

const sampleSession = {
  session_id: 'sess-1',
  workspace_id: 'ws-1',
  tenant_id: 'tenant-1',
  title: 'Test Chat',
  memory: [
    { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:01:00Z' },
    { role: 'assistant', content: 'Hi there!', timestamp: '2024-01-01T00:01:01Z' },
  ],
  created_at: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  ddbMock.reset();
});

// ─── handleCreateSession ─────────────────────────────────────────────────────

describe('handleCreateSession', () => {
  it('creates session with provided title', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    ddbMock.on(PutCommand).resolves({});

    const res = await handleCreateSession(makeReq({
      method: 'POST',
      pathParams: { id: 'ws-1' },
      body: { title: 'Invoice Questions' },
    }));

    expect(res.statusCode).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(body.title).toBe('Invoice Questions');
    expect(body.session_id).toBeDefined();
    expect(body.workspace_id).toBe('ws-1');
    expect(body.tenant_id).toBe('tenant-1');
    expect(body.memory).toEqual([]);
    expect(body.created_at).toBeDefined();
  });

  it('creates session with default title when none provided', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    ddbMock.on(PutCommand).resolves({});

    const res = await handleCreateSession(makeReq({
      method: 'POST',
      pathParams: { id: 'ws-1' },
      body: {},
    }));

    expect(res.statusCode).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(body.title).toBe('New Chat');
  });

  it('returns 403 when workspace belongs to different tenant', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: { ...sampleWorkspace, tenant_id: 'other-tenant' } });

    const res = await handleCreateSession(makeReq({
      method: 'POST',
      pathParams: { id: 'ws-1' },
      body: { title: 'Test' },
    }));

    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when workspace does not exist', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-missing' } })
      .resolves({ Item: undefined });

    const res = await handleCreateSession(makeReq({
      method: 'POST',
      pathParams: { id: 'ws-missing' },
      body: { title: 'Test' },
    }));

    expect(res.statusCode).toBe(404);
  });
});


// ─── handleListSessions ──────────────────────────────────────────────────────

describe('handleListSessions', () => {
  it('returns session summaries without memory, sorted descending', async () => {
    const olderSession = {
      ...sampleSession,
      session_id: 'sess-old',
      title: 'Old Chat',
      memory: [{ role: 'user', content: 'Hi', timestamp: '2024-01-01T00:00:00Z' }],
      created_at: '2024-01-01T00:00:00Z',
    };
    const newerSession = {
      ...sampleSession,
      session_id: 'sess-new',
      title: 'New Chat',
      memory: [
        { role: 'user', content: 'Hello', timestamp: '2024-01-02T00:00:00Z' },
        { role: 'assistant', content: 'Hi!', timestamp: '2024-01-02T00:00:01Z' },
      ],
      created_at: '2024-01-02T00:00:00Z',
    };

    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    ddbMock.on(QueryCommand, { TableName: SESSIONS_TABLE, IndexName: 'workspace-index' })
      .resolves({ Items: [olderSession, newerSession] });

    const res = await handleListSessions(makeReq({
      pathParams: { id: 'ws-1' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as { sessions: Array<Record<string, unknown>>; count: number };

    // Sorted descending — newer first
    expect(body.sessions[0].session_id).toBe('sess-new');
    expect(body.sessions[1].session_id).toBe('sess-old');

    // Summaries exclude memory, include message_count
    for (const s of body.sessions) {
      expect(s).not.toHaveProperty('memory');
      expect(s).toHaveProperty('message_count');
      expect(s).toHaveProperty('session_id');
      expect(s).toHaveProperty('workspace_id');
      expect(s).toHaveProperty('title');
      expect(s).toHaveProperty('created_at');
    }

    // message_count reflects memory length
    expect(body.sessions[0].message_count).toBe(2);
    expect(body.sessions[1].message_count).toBe(1);
  });

  it('includes count in response', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    ddbMock.on(QueryCommand, { TableName: SESSIONS_TABLE, IndexName: 'workspace-index' })
      .resolves({ Items: [sampleSession] });

    const res = await handleListSessions(makeReq({ pathParams: { id: 'ws-1' } }));
    const body = res.body as { count: number };
    expect(body.count).toBe(1);
  });

  it('returns 403 when workspace belongs to different tenant', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: { ...sampleWorkspace, tenant_id: 'other-tenant' } });

    const res = await handleListSessions(makeReq({ pathParams: { id: 'ws-1' } }));
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 when workspace does not exist', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-missing' } })
      .resolves({ Item: undefined });

    const res = await handleListSessions(makeReq({ pathParams: { id: 'ws-missing' } }));
    expect(res.statusCode).toBe(404);
  });
});


// ─── handleGetSession ────────────────────────────────────────────────────────

describe('handleGetSession', () => {
  it('returns full session with memory', async () => {
    ddbMock.on(GetCommand, { TableName: SESSIONS_TABLE, Key: { session_id: 'sess-1' } })
      .resolves({ Item: sampleSession });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });

    const res = await handleGetSession(makeReq({ pathParams: { id: 'sess-1' } }));

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.session_id).toBe('sess-1');
    expect(body.memory).toBeDefined();
    expect(Array.isArray(body.memory)).toBe(true);
    expect((body.memory as unknown[]).length).toBe(2);
  });

  it('returns 404 when session does not exist', async () => {
    ddbMock.on(GetCommand, { TableName: SESSIONS_TABLE, Key: { session_id: 'missing' } })
      .resolves({ Item: undefined });

    const res = await handleGetSession(makeReq({ pathParams: { id: 'missing' } }));
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when session belongs to different tenant', async () => {
    ddbMock.on(GetCommand, { TableName: SESSIONS_TABLE, Key: { session_id: 'sess-1' } })
      .resolves({ Item: sampleSession });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: { ...sampleWorkspace, tenant_id: 'other-tenant' } });

    const res = await handleGetSession(makeReq({ pathParams: { id: 'sess-1' } }));
    expect(res.statusCode).toBe(403);
  });
});

// ─── handleDeleteSession ─────────────────────────────────────────────────────

describe('handleDeleteSession', () => {
  it('deletes session and returns confirmation', async () => {
    ddbMock.on(GetCommand, { TableName: SESSIONS_TABLE, Key: { session_id: 'sess-1' } })
      .resolves({ Item: sampleSession });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    ddbMock.on(DeleteCommand).resolves({});

    const res = await handleDeleteSession(makeReq({
      method: 'DELETE',
      pathParams: { id: 'sess-1' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as { message: string };
    expect(body.message).toContain('deleted');
  });

  it('returns 404 when session does not exist', async () => {
    ddbMock.on(GetCommand, { TableName: SESSIONS_TABLE, Key: { session_id: 'missing' } })
      .resolves({ Item: undefined });

    const res = await handleDeleteSession(makeReq({
      method: 'DELETE',
      pathParams: { id: 'missing' },
    }));
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when session belongs to different tenant', async () => {
    ddbMock.on(GetCommand, { TableName: SESSIONS_TABLE, Key: { session_id: 'sess-1' } })
      .resolves({ Item: sampleSession });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: { ...sampleWorkspace, tenant_id: 'other-tenant' } });

    const res = await handleDeleteSession(makeReq({
      method: 'DELETE',
      pathParams: { id: 'sess-1' },
    }));
    expect(res.statusCode).toBe(403);
  });
});
