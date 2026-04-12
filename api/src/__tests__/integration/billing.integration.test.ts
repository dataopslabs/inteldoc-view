/**
 * G6-06: Integration tests for billing handler — plan get, change, export.
 */
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ApiRequest, Tenant } from '../../models/types';

const ddbMock = mockClient(DynamoDBDocumentClient);

import { handleGetPlan, handleChangePlan } from '../../handlers/billing';

const mockTenant: Tenant = {
  tenant_id: 'tenant-billing-1',
  email: 'billing@test.com',
  plan: 'free',
  created_at: '2024-01-01T00:00:00.000Z',
};

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    path: '/v1/tenant/plan',
    pathParams: {},
    queryParams: {},
    body: null,
    headers: {},
    context: {
      tenantId: mockTenant.tenant_id,
      userId: 'user-1',
      role: 'admin',
      tenant: mockTenant,
    },
    ...overrides,
  };
}

beforeEach(() => ddbMock.reset());

describe('handleGetPlan', () => {
  test('returns plan with usage and limits', async () => {
    ddbMock
      .on(GetCommand)
      .resolves({ Item: { tenant_id: 'tenant-billing-1', billing_period: '2024-01', documents: 3, tokens: 1000, chats: 5, updated_at: '' } })
      .on(QueryCommand)
      .resolves({ Items: [] });

    const response = await handleGetPlan(makeReq());
    expect(response.statusCode).toBe(200);
    const body = response.body as any;
    expect(body.plan).toBe('free');
    expect(body.limits).toBeDefined();
    expect(body.usage).toBeDefined();
    expect(body.billing_period).toBeDefined();
  });
});

describe('handleChangePlan', () => {
  test('upgrades plan from free to pro', async () => {
    ddbMock.on(PutCommand).resolves({});

    const req = makeReq({
      method: 'POST',
      body: { plan: 'pro' },
    });
    const response = await handleChangePlan(req);
    expect(response.statusCode).toBe(200);
    const body = response.body as any;
    expect(body.plan).toBe('pro');
    expect(body.upgrade).toBe(true);
  });

  test('downgrades plan from pro to free with grace period', async () => {
    ddbMock.on(PutCommand).resolves({});

    const proTenant = { ...mockTenant, plan: 'pro' as const };
    const req = makeReq({
      method: 'POST',
      body: { plan: 'free' },
      context: {
        tenantId: proTenant.tenant_id,
        userId: 'user-1',
        role: 'admin',
        tenant: proTenant,
      },
    });
    const response = await handleChangePlan(req);
    expect(response.statusCode).toBe(200);
    const body = response.body as any;
    expect(body.plan).toBe('free');
    expect(body.upgrade).toBe(false);
    expect(body.downgrade_at).toBeDefined();
  });

  test('returns 400 for invalid plan name', async () => {
    const req = makeReq({ method: 'POST', body: { plan: 'ultra' } });
    const response = await handleChangePlan(req);
    expect(response.statusCode).toBe(400);
    expect((response.body as any).error).toMatch(/Invalid plan/);
  });

  test('returns 400 when plan unchanged', async () => {
    const req = makeReq({ method: 'POST', body: { plan: 'free' } });
    const response = await handleChangePlan(req);
    expect(response.statusCode).toBe(400);
    expect((response.body as any).error).toMatch(/already on/);
  });
});
