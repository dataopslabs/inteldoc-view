/**
 * G6-06: Integration tests for workspace handler — uses aws-sdk-client-mock.
 *
 * These tests mock DynamoDB at the AWS SDK level and test the full handler
 * path including validation, DynamoDB writes, and response shapes.
 */
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ApiRequest, Tenant } from '../../models/types';

// Mock the DynamoDB client before importing handlers
const ddbMock = mockClient(DynamoDBDocumentClient);

// Must import after mock is set up
import { handleCreateWorkspace, handleGetWorkspace, handleListWorkspaces } from '../../handlers/workspace';

const mockTenant: Tenant = {
  tenant_id: 'test-tenant-1',
  email: 'test@example.com',
  plan: 'pro',
  created_at: '2024-01-01T00:00:00.000Z',
};

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    path: '/v1/workspaces',
    pathParams: {},
    queryParams: {},
    body: null,
    headers: {},
    context: {
      tenantId: mockTenant.tenant_id,
      userId: 'user-1',
      role: 'editor',
      tenant: mockTenant,
    },
    ...overrides,
  };
}

beforeEach(() => {
  ddbMock.reset();
});

describe('handleCreateWorkspace', () => {
  test('creates workspace and returns 201', async () => {
    ddbMock.on(PutCommand).resolves({});

    const req = makeReq({
      method: 'POST',
      path: '/v1/workspaces',
      body: { name: 'Test Workspace', hitl_threshold: 0.8 },
    });

    const response = await handleCreateWorkspace(req);
    expect(response.statusCode).toBe(201);
    const body = response.body as any;
    expect(body.workspace_id).toBeDefined();
    expect(body.name).toBe('Test Workspace');
    expect(body.tenant_id).toBe('test-tenant-1');
    expect(body.created_at).toBeDefined();
    expect(body.updated_at).toBeDefined(); // G6-15: updated_at must be present on creation
  });

  test('returns 400 when name is missing', async () => {
    const req = makeReq({
      method: 'POST',
      body: { description: 'No name' },
    });
    const response = await handleCreateWorkspace(req);
    expect(response.statusCode).toBe(400);
    expect((response.body as any).error).toMatch(/name is required/);
  });

  test('returns 400 for invalid hitl_threshold', async () => {
    const req = makeReq({
      method: 'POST',
      body: { name: 'Test', hitl_threshold: 1.5 },
    });
    const response = await handleCreateWorkspace(req);
    expect(response.statusCode).toBe(400);
    expect((response.body as any).error).toMatch(/hitl_threshold/);
  });

  test('returns 400 for invalid agent names', async () => {
    const req = makeReq({
      method: 'POST',
      body: { name: 'Test', agents: ['parsing', 'hacker_agent'] },
    });
    const response = await handleCreateWorkspace(req);
    expect(response.statusCode).toBe(400);
    expect((response.body as any).error).toMatch(/Unrecognized agent/);
  });
});

describe('handleGetWorkspace', () => {
  test('returns workspace when found and tenant matches', async () => {
    const workspace = {
      workspace_id: 'ws-1',
      tenant_id: 'test-tenant-1',
      name: 'My WS',
      prompt_version: '1.0.0',
      hitl_threshold: 0.8,
      created_at: '2024-01-01T00:00:00.000Z',
    };
    ddbMock.on(GetCommand).resolves({ Item: workspace });

    const req = makeReq({ pathParams: { id: 'ws-1' } });
    const response = await handleGetWorkspace(req);
    expect(response.statusCode).toBe(200);
    expect((response.body as any).workspace_id).toBe('ws-1');
  });

  test('returns 404 when not found', async () => {
    ddbMock.on(GetCommand).resolves({ Item: undefined });
    const req = makeReq({ pathParams: { id: 'missing-ws' } });
    const response = await handleGetWorkspace(req);
    expect(response.statusCode).toBe(404);
  });

  test('returns 404 for soft-deleted workspace', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { workspace_id: 'ws-deleted', tenant_id: 'test-tenant-1', deleted_at: '2024-01-02T00:00:00.000Z' },
    });
    const req = makeReq({ pathParams: { id: 'ws-deleted' } });
    const response = await handleGetWorkspace(req);
    expect(response.statusCode).toBe(404);
  });

  test('returns 403 for cross-tenant access', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { workspace_id: 'ws-other', tenant_id: 'OTHER-TENANT', name: 'Other WS', prompt_version: '1.0.0', hitl_threshold: 0.8, created_at: '2024-01-01T00:00:00.000Z' },
    });
    const req = makeReq({ pathParams: { id: 'ws-other' } });
    const response = await handleGetWorkspace(req);
    expect(response.statusCode).toBe(403);
  });
});

describe('handleListWorkspaces', () => {
  test('lists only non-deleted workspaces', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { workspace_id: 'ws-1', tenant_id: 'test-tenant-1', name: 'Active WS' },
        { workspace_id: 'ws-2', tenant_id: 'test-tenant-1', name: 'Deleted WS', deleted_at: '2024-01-01T00:00:00.000Z' },
      ],
    });

    const req = makeReq();
    const response = await handleListWorkspaces(req);
    expect(response.statusCode).toBe(200);
    const body = response.body as any;
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0].workspace_id).toBe('ws-1');
    expect(body.count).toBe(1);
  });
});
