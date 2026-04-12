import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handleCreateWorkspace, handleUpdateWorkspace } from '../handlers/workspace';
import { ApiRequest } from '../models/types';

const ddbMock = mockClient(DynamoDBDocumentClient);

const WORKSPACES_TABLE = process.env.WORKSPACES_TABLE ?? 'docops-workspaces';

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'POST',
    path: '/v1/workspaces',
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
  prompt_version: '1.0.0',
  agents: [],
  hitl_threshold: 0.8,
  created_at: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  ddbMock.reset();
});

// ─── handleCreateWorkspace agent validation ──────────────────────────────────

describe('handleCreateWorkspace - agent validation', () => {
  it('accepts valid agent names as strings', async () => {
    ddbMock.on(PutCommand).resolves({});

    const res = await handleCreateWorkspace(makeReq({
      body: { name: 'My Workspace', agents: ['parsing', 'extraction', 'validation', 'reconciliation'] },
    }));

    expect(res.statusCode).toBe(201);
  });

  it('rejects unrecognized agent name with 400', async () => {
    const res = await handleCreateWorkspace(makeReq({
      body: { name: 'My Workspace', agents: ['parsing', 'unknown_agent'] },
    }));

    expect(res.statusCode).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toContain('unknown_agent');
    expect(body.error).toContain('Unrecognized agent name');
  });

  it('accepts valid agent names as objects with agent_name', async () => {
    ddbMock.on(PutCommand).resolves({});

    const res = await handleCreateWorkspace(makeReq({
      body: {
        name: 'My Workspace',
        agents: [
          { agent_name: 'parsing' },
          { agent_name: 'extraction', model_id: 'anthropic.claude-3-sonnet' },
        ],
      },
    }));

    expect(res.statusCode).toBe(201);
  });

  it('rejects object agent config with invalid agent_name', async () => {
    const res = await handleCreateWorkspace(makeReq({
      body: {
        name: 'My Workspace',
        agents: [{ agent_name: 'bad_agent' }],
      },
    }));

    expect(res.statusCode).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toContain('bad_agent');
  });

  it('allows workspace creation without agents field', async () => {
    ddbMock.on(PutCommand).resolves({});

    const res = await handleCreateWorkspace(makeReq({
      body: { name: 'My Workspace' },
    }));

    expect(res.statusCode).toBe(201);
  });
});

// ─── handleUpdateWorkspace agent validation ──────────────────────────────────

describe('handleUpdateWorkspace - agent validation', () => {
  it('accepts valid agent names on update', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: { ...sampleWorkspace, agents: ['parsing', 'extraction'] } });

    const res = await handleUpdateWorkspace(makeReq({
      method: 'PUT',
      pathParams: { id: 'ws-1' },
      body: { agents: ['parsing', 'extraction'] },
    }));

    expect(res.statusCode).toBe(200);
  });

  it('rejects unrecognized agent name on update with 400', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });

    const res = await handleUpdateWorkspace(makeReq({
      method: 'PUT',
      pathParams: { id: 'ws-1' },
      body: { agents: ['parsing', 'nonexistent'] },
    }));

    expect(res.statusCode).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toContain('nonexistent');
    expect(body.error).toContain('Unrecognized agent name');
  });

  it('accepts mixed string and object agent configs on update', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });

    const res = await handleUpdateWorkspace(makeReq({
      method: 'PUT',
      pathParams: { id: 'ws-1' },
      body: {
        agents: [
          'parsing',
          { agent_name: 'extraction', model_id: 'anthropic.claude-3-sonnet' },
          'validation',
        ],
      },
    }));

    expect(res.statusCode).toBe(200);
  });

  it('rejects object with missing agent_name on update', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });

    const res = await handleUpdateWorkspace(makeReq({
      method: 'PUT',
      pathParams: { id: 'ws-1' },
      body: { agents: [{ model_id: 'some-model' }] },
    }));

    expect(res.statusCode).toBe(400);
    const body = res.body as { error: string };
    expect(body.error).toContain('Unrecognized agent name');
  });

  it('allows update without agents field', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: { ...sampleWorkspace, name: 'Updated' } });

    const res = await handleUpdateWorkspace(makeReq({
      method: 'PUT',
      pathParams: { id: 'ws-1' },
      body: { name: 'Updated' },
    }));

    expect(res.statusCode).toBe(200);
  });
});
