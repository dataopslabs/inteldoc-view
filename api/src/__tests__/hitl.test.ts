import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { handleListReviews, handleGetReview, handleAssignReview, handleSubmitCorrections, handleResolveReview } from '../handlers/hitl';
import { ApiRequest } from '../models/types';

const ddbMock = mockClient(DynamoDBDocumentClient);

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    path: '/v1/hitl',
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

const WORKSPACES_TABLE = process.env.WORKSPACES_TABLE ?? 'docops-workspaces';
const TRACES_TABLE = process.env.TRACES_TABLE ?? 'docops-traces';
const HITL_TABLE = process.env.HITL_REVIEWS_TABLE ?? 'docops-hitl-reviews';

const sampleWorkspace = {
  workspace_id: 'ws-1',
  tenant_id: 'tenant-1',
  name: 'Test Workspace',
  prompt_version: 'v1',
  hitl_threshold: 0.8,
  created_at: '2024-01-01T00:00:00Z',
};

const sampleTrace = {
  trace_id: 'trace-1',
  workspace_id: 'ws-1',
  status: 'hitl_required',
  confidence: 0.5,
  prompt_version: 'v1',
  created_at: '2024-01-01T00:00:00Z',
  fields: [
    { field_name: 'invoice_number', value: 'INV-001', confidence: 0.6 },
    { field_name: 'amount', value: '100.00', confidence: 0.9 },
  ],
};

const sampleReview = {
  trace_id: 'trace-1',
  workspace_id: 'ws-1',
  status: 'pending',
  corrections: [],
  created_at: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  ddbMock.reset();
});


// ─── handleListReviews ───────────────────────────────────────────────────────

describe('handleListReviews', () => {
  it('returns reviews filtered by workspace_id', async () => {
    // Mock workspace lookup
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    // Mock query on workspace-index
    ddbMock.on(QueryCommand, { TableName: HITL_TABLE, IndexName: 'workspace-index' })
      .resolves({ Items: [sampleReview] });

    const res = await handleListReviews(makeReq({ queryParams: { workspace_id: 'ws-1' } }));
    expect(res.statusCode).toBe(200);
    const body = res.body as { reviews: unknown[]; count: number };
    expect(body.reviews).toHaveLength(1);
    expect(body.count).toBe(1);
  });

  it('returns reviews filtered by status', async () => {
    ddbMock.on(QueryCommand, { TableName: HITL_TABLE, IndexName: 'status-index' })
      .resolves({ Items: [sampleReview, { ...sampleReview, trace_id: 'trace-2' }] });

    const res = await handleListReviews(makeReq({ queryParams: { status: 'pending' } }));
    expect(res.statusCode).toBe(200);
    const body = res.body as { reviews: unknown[]; count: number };
    expect(body.reviews).toHaveLength(2);
    expect(body.count).toBe(2);
  });

  it('returns reviews filtered by both workspace_id and status', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    // Query by status, then filter by workspace_id in handler
    ddbMock.on(QueryCommand, { TableName: HITL_TABLE, IndexName: 'status-index' })
      .resolves({
        Items: [
          sampleReview,
          { ...sampleReview, trace_id: 'trace-other', workspace_id: 'ws-other' },
        ],
      });

    const res = await handleListReviews(makeReq({ queryParams: { workspace_id: 'ws-1', status: 'pending' } }));
    expect(res.statusCode).toBe(200);
    const body = res.body as { reviews: unknown[]; count: number };
    expect(body.reviews).toHaveLength(1);
    expect(body.count).toBe(1);
  });

  it('response includes count', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [sampleReview] });
    const res = await handleListReviews(makeReq({ queryParams: { status: 'pending' } }));
    const body = res.body as { count: number };
    expect(body.count).toBe(1);
  });

  it('returns 403 when workspace belongs to different tenant', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: { ...sampleWorkspace, tenant_id: 'other-tenant' } });

    const res = await handleListReviews(makeReq({ queryParams: { workspace_id: 'ws-1' } }));
    expect(res.statusCode).toBe(403);
  });
});


// ─── handleGetReview ─────────────────────────────────────────────────────────

describe('handleGetReview', () => {
  it('returns review + trace on success', async () => {
    ddbMock.on(GetCommand, { TableName: HITL_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleReview });
    ddbMock.on(GetCommand, { TableName: TRACES_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleTrace });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });

    const res = await handleGetReview(makeReq({ pathParams: { trace_id: 'trace-1' } }));
    expect(res.statusCode).toBe(200);
    const body = res.body as { review: typeof sampleReview; trace: typeof sampleTrace };
    expect(body.review.trace_id).toBe('trace-1');
    expect(body.trace.trace_id).toBe('trace-1');
    expect(body.trace.fields).toBeDefined();
  });

  it('returns 404 when review not found', async () => {
    ddbMock.on(GetCommand, { TableName: HITL_TABLE, Key: { trace_id: 'missing' } })
      .resolves({ Item: undefined });

    const res = await handleGetReview(makeReq({ pathParams: { trace_id: 'missing' } }));
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when trace belongs to different tenant', async () => {
    ddbMock.on(GetCommand, { TableName: HITL_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleReview });
    ddbMock.on(GetCommand, { TableName: TRACES_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleTrace });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: { ...sampleWorkspace, tenant_id: 'other-tenant' } });

    const res = await handleGetReview(makeReq({ pathParams: { trace_id: 'trace-1' } }));
    expect(res.statusCode).toBe(403);
  });
});


// ─── handleAssignReview ──────────────────────────────────────────────────────

describe('handleAssignReview', () => {
  it('success: updates status to in_review with reviewer and assigned_at', async () => {
    ddbMock.on(GetCommand, { TableName: HITL_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleReview });
    ddbMock.on(GetCommand, { TableName: TRACES_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleTrace });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        ...sampleReview,
        status: 'in_review',
        reviewer: 'reviewer@test.com',
        assigned_at: '2024-01-02T00:00:00Z',
      },
    });

    const res = await handleAssignReview(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'trace-1' },
      body: { reviewer: 'reviewer@test.com' },
    }));
    expect(res.statusCode).toBe(200);
    const body = res.body as { review: { status: string; reviewer: string; assigned_at: string } };
    expect(body.review.status).toBe('in_review');
    expect(body.review.reviewer).toBe('reviewer@test.com');
    expect(body.review.assigned_at).toBeDefined();
  });

  it('returns 400 when reviewer missing', async () => {
    const res = await handleAssignReview(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'trace-1' },
      body: {},
    }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when review not found', async () => {
    ddbMock.on(GetCommand, { TableName: HITL_TABLE, Key: { trace_id: 'missing' } })
      .resolves({ Item: undefined });

    const res = await handleAssignReview(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'missing' },
      body: { reviewer: 'reviewer@test.com' },
    }));
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when review is not pending (e.g., in_review)', async () => {
    ddbMock.on(GetCommand, { TableName: HITL_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: { ...sampleReview, status: 'in_review' } });
    ddbMock.on(GetCommand, { TableName: TRACES_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleTrace });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });

    const res = await handleAssignReview(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'trace-1' },
      body: { reviewer: 'reviewer@test.com' },
    }));
    expect(res.statusCode).toBe(409);
  });
});


// ─── handleSubmitCorrections ─────────────────────────────────────────────────

describe('handleSubmitCorrections', () => {
  const inReviewReview = { ...sampleReview, status: 'in_review', reviewer: 'reviewer@test.com', assigned_at: '2024-01-02T00:00:00Z' };

  it('success: appends corrections', async () => {
    ddbMock.on(GetCommand, { TableName: HITL_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: inReviewReview });
    ddbMock.on(GetCommand, { TableName: TRACES_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleTrace });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    const corrections = [{ field_name: 'invoice_number', original_value: 'INV-001', corrected_value: 'INV-1001' }];
    ddbMock.on(UpdateCommand).resolves({
      Attributes: { ...inReviewReview, corrections },
    });

    const res = await handleSubmitCorrections(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'trace-1' },
      body: { corrections },
    }));
    expect(res.statusCode).toBe(200);
    const body = res.body as { review: { corrections: unknown[] } };
    expect(body.review.corrections).toHaveLength(1);
  });

  it('returns 400 when correction missing field_name', async () => {
    const res = await handleSubmitCorrections(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'trace-1' },
      body: { corrections: [{ original_value: 'a', corrected_value: 'b' }] },
    }));
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('field_name');
  });

  it('returns 400 when correction missing original_value', async () => {
    const res = await handleSubmitCorrections(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'trace-1' },
      body: { corrections: [{ field_name: 'f', corrected_value: 'b' }] },
    }));
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('original_value');
  });

  it('returns 400 when correction missing corrected_value', async () => {
    const res = await handleSubmitCorrections(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'trace-1' },
      body: { corrections: [{ field_name: 'f', original_value: 'a' }] },
    }));
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('corrected_value');
  });

  it('returns 409 when review is not in_review (e.g., pending)', async () => {
    ddbMock.on(GetCommand, { TableName: HITL_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleReview }); // status: 'pending'
    ddbMock.on(GetCommand, { TableName: TRACES_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleTrace });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });

    const res = await handleSubmitCorrections(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'trace-1' },
      body: { corrections: [{ field_name: 'f', original_value: 'a', corrected_value: 'b' }] },
    }));
    expect(res.statusCode).toBe(409);
  });
});


// ─── handleResolveReview ─────────────────────────────────────────────────────

describe('handleResolveReview', () => {
  const inReviewReview = {
    ...sampleReview,
    status: 'in_review',
    reviewer: 'reviewer@test.com',
    assigned_at: '2024-01-02T00:00:00Z',
    corrections: [{ field_name: 'invoice_number', original_value: 'INV-001', corrected_value: 'INV-1001' }],
  };

  it('success: resolves with metrics (review_duration_ms, correction_count)', async () => {
    ddbMock.on(GetCommand, { TableName: HITL_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: inReviewReview });
    ddbMock.on(GetCommand, { TableName: TRACES_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleTrace });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });
    ddbMock.on(UpdateCommand).resolves({
      Attributes: {
        ...inReviewReview,
        status: 'resolved',
        resolved_at: '2024-01-02T01:00:00Z',
        review_duration_ms: 3600000,
        correction_count: 1,
      },
    });

    const res = await handleResolveReview(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'trace-1' },
    }));
    expect(res.statusCode).toBe(200);
    const body = res.body as { review: { status: string; review_duration_ms: number; correction_count: number } };
    expect(body.review.status).toBe('resolved');
    expect(body.review.review_duration_ms).toBeDefined();
    expect(body.review.correction_count).toBe(1);
  });

  it('returns 409 when review is not in_review', async () => {
    ddbMock.on(GetCommand, { TableName: HITL_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleReview }); // status: 'pending'
    ddbMock.on(GetCommand, { TableName: TRACES_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleTrace });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });

    const res = await handleResolveReview(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'trace-1' },
    }));
    expect(res.statusCode).toBe(409);
  });

  it('returns 500 and reverts review to in_review when trace update fails', async () => {
    ddbMock.on(GetCommand, { TableName: HITL_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: inReviewReview });
    ddbMock.on(GetCommand, { TableName: TRACES_TABLE, Key: { trace_id: 'trace-1' } })
      .resolves({ Item: sampleTrace });
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });

    // First UpdateCommand call (resolve review) succeeds
    // Second UpdateCommand call (update trace) fails
    // Third UpdateCommand call (revert review) succeeds
    let updateCallCount = 0;
    ddbMock.on(UpdateCommand).callsFake(() => {
      updateCallCount++;
      if (updateCallCount === 1) {
        // Resolve review — success
        return {
          Attributes: {
            ...inReviewReview,
            status: 'resolved',
            resolved_at: '2024-01-02T01:00:00Z',
            review_duration_ms: 3600000,
            correction_count: 1,
          },
        };
      }
      if (updateCallCount === 2) {
        // Update trace — fail
        throw new Error('DynamoDB write error');
      }
      // Revert review — success
      return { Attributes: { ...inReviewReview, status: 'in_review' } };
    });

    const res = await handleResolveReview(makeReq({
      method: 'POST',
      pathParams: { trace_id: 'trace-1' },
    }));
    expect(res.statusCode).toBe(500);
    expect((res.body as { error: string }).error).toContain('reverted');
    expect(updateCallCount).toBe(3); // resolve + trace fail + revert
  });
});
