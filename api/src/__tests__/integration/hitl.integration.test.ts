/**
 * G6-06: Integration tests for HITL handler — state machine transitions, validation.
 */
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApiRequest, Tenant, HitlReview } from '../../models/types';

const ddbMock = mockClient(DynamoDBDocumentClient);

import { handleAssignReview, handleSubmitCorrections } from '../../handlers/hitl';

const tenant: Tenant = { tenant_id: 't1', email: 'e@t.com', plan: 'pro', created_at: '' };

const mockTrace = {
  trace_id: 'trace-1',
  workspace_id: 'ws-1',
  tenant_id: 't1',
  status: 'hitl_required',
  prompt_version: '1.0.0',
  created_at: '2024-01-01T00:00:00Z',
};

const mockWorkspace = { workspace_id: 'ws-1', tenant_id: 't1', name: 'WS', prompt_version: '1.0.0', hitl_threshold: 0.8, created_at: '' };

const pendingReview: HitlReview = {
  trace_id: 'trace-1',
  workspace_id: 'ws-1',
  status: 'pending',
  corrections: [],
  created_at: '2024-01-01T00:00:00Z',
};

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'POST',
    path: '/v1/hitl/trace-1/assign',
    pathParams: { trace_id: 'trace-1' },
    queryParams: {},
    body: null,
    headers: {},
    context: { tenantId: 't1', userId: 'user-1', role: 'reviewer', tenant },
    ...overrides,
  };
}

beforeEach(() => ddbMock.reset());

describe('handleAssignReview', () => {
  test('assigns pending review to reviewer', async () => {
    ddbMock
      .on(GetCommand)
      .resolvesOnce({ Item: pendingReview })
      .resolvesOnce({ Item: mockTrace })
      .resolvesOnce({ Item: mockWorkspace });
    ddbMock
      .on(UpdateCommand)
      .resolves({
        Attributes: {
          ...pendingReview,
          status: 'in_review',
          reviewer: 'reviewer@test.com',
          assigned_at: new Date().toISOString(),
        },
      });

    const req = makeReq({ body: { reviewer: 'reviewer@test.com' } });
    const response = await handleAssignReview(req);
    expect(response.statusCode).toBe(200);
  });

  test('returns 400 when reviewer is missing', async () => {
    const req = makeReq({ body: {} });
    const response = await handleAssignReview(req);
    expect(response.statusCode).toBe(400);
    expect((response.body as any).error).toMatch(/reviewer/);
  });
});

describe('handleSubmitCorrections', () => {
  test('returns 400 for empty corrections array', async () => {
    const req = makeReq({
      path: '/v1/hitl/trace-1/corrections',
      body: { corrections: [] },
    });
    const response = await handleSubmitCorrections(req);
    expect(response.statusCode).toBe(400);
    expect((response.body as any).error).toMatch(/must not be empty/);
  });

  test('returns 400 for missing corrections', async () => {
    const req = makeReq({ body: {} });
    const response = await handleSubmitCorrections(req);
    expect(response.statusCode).toBe(400);
    expect((response.body as any).error).toMatch(/corrections array is required/);
  });

  test('returns 400 for correction missing field_name', async () => {
    const req = makeReq({ body: { corrections: [{ original_value: 'a', corrected_value: 'b' }] } });
    const response = await handleSubmitCorrections(req);
    expect(response.statusCode).toBe(400);
    expect((response.body as any).error).toMatch(/field_name/);
  });
});
