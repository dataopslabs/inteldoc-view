import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  handleGetDashboard,
  handleGetTraceMetrics,
  handleGetAgentMetrics,
  handleGetUsage,
} from '../handlers/observability';
import { metricsCache } from '../lib/metrics-cache';
import { ApiRequest } from '../models/types';

const ddbMock = mockClient(DynamoDBDocumentClient);

const WORKSPACES_TABLE = process.env.WORKSPACES_TABLE ?? 'docops-workspaces';
const TRACES_TABLE = process.env.TRACES_TABLE ?? 'docops-traces';
const HITL_TABLE = process.env.HITL_REVIEWS_TABLE ?? 'docops-hitl-reviews';
const SESSIONS_TABLE = process.env.SESSIONS_TABLE ?? 'docops-sessions';
const TENANTS_TABLE = process.env.TENANTS_TABLE ?? 'docops-tenants';

const sampleWorkspace = {
  workspace_id: 'ws-1',
  tenant_id: 'tenant-1',
  name: 'Test Workspace',
  prompt_version: 'v1',
  hitl_threshold: 0.8,
  created_at: '2024-01-01T00:00:00Z',
};

const sampleTraces = [
  { trace_id: 't-1', workspace_id: 'ws-1', status: 'completed', confidence: 0.9, tokens: 1000, latency: 2000, created_at: '2024-01-15T10:00:00Z', prompt_version: 'v1' },
  { trace_id: 't-2', workspace_id: 'ws-1', status: 'failed', confidence: null, tokens: 500, latency: null, error: 'Timeout', created_at: '2024-01-15T11:00:00Z', prompt_version: 'v1' },
  { trace_id: 't-3', workspace_id: 'ws-1', status: 'hitl_required', confidence: 0.6, tokens: 800, latency: 3000, created_at: '2024-01-15T12:00:00Z', prompt_version: 'v1' },
];

const sampleReviews = [
  { trace_id: 't-3', workspace_id: 'ws-1', status: 'pending', corrections: [], created_at: '2024-01-15T12:00:00Z' },
  { trace_id: 't-4', workspace_id: 'ws-1', status: 'resolved', corrections: [], review_duration_ms: 60000, correction_count: 2, created_at: '2024-01-14T10:00:00Z' },
];

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    path: '/v1/observability',
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


/**
 * Helper to set up standard DynamoDB mocks for dashboard/trace/agent handlers.
 * Routes QueryCommand responses based on TableName and IndexName.
 */
function setupStandardMocks() {
  // GetCommand for workspace lookup
  ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
    .resolves({ Item: sampleWorkspace });

  // QueryCommand routing based on table + index
  ddbMock.on(QueryCommand).callsFake((input) => {
    const table = input.TableName;
    const index = input.IndexName;

    // tenant-index on workspaces → return workspaces
    if (table === WORKSPACES_TABLE && index === 'tenant-index') {
      return { Items: [sampleWorkspace] };
    }
    // workspace-index on traces → return traces
    if (table === TRACES_TABLE && index === 'workspace-index') {
      return { Items: sampleTraces };
    }
    // workspace-index on hitl-reviews → return reviews
    if (table === HITL_TABLE && index === 'workspace-index') {
      return { Items: sampleReviews };
    }
    // workspace-index on sessions → return empty
    if (table === SESSIONS_TABLE && index === 'workspace-index') {
      return { Items: [] };
    }
    return { Items: [] };
  });
}

beforeEach(() => {
  ddbMock.reset();
  metricsCache.clear();
});

// ─── 9.1: handleGetDashboard ─────────────────────────────────────────────────

describe('handleGetDashboard', () => {
  it('returns basic dashboard response with workspace filter', async () => {
    setupStandardMocks();

    const res = await handleGetDashboard(makeReq({
      queryParams: { workspace_id: 'ws-1', start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('dashboard');
    expect(body).toHaveProperty('hitl');
    expect(body).toHaveProperty('error_analysis');
    expect(body).toHaveProperty('time_range');

    const dashboard = body.dashboard as Record<string, unknown>;
    expect(dashboard.total_traces).toBe(3);
    expect(dashboard.success_count).toBe(1);
    expect(dashboard.failure_count).toBe(1);
    expect(dashboard.hitl_required_count).toBe(1);
  });

  it('returns per-workspace metrics when group_by=workspace', async () => {
    setupStandardMocks();

    const res = await handleGetDashboard(makeReq({
      queryParams: { group_by: 'workspace', start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('workspaces');
    const workspaces = body.workspaces as Array<{ workspace_id: string; workspace_name: string; metrics: Record<string, unknown> }>;
    expect(workspaces.length).toBeGreaterThan(0);
    expect(workspaces[0]).toHaveProperty('workspace_id');
    expect(workspaces[0]).toHaveProperty('workspace_name');
    expect(workspaces[0]).toHaveProperty('metrics');
  });

  it('returns time-series buckets when granularity=daily', async () => {
    setupStandardMocks();

    const res = await handleGetDashboard(makeReq({
      queryParams: { granularity: 'daily', start: '2024-01-14T00:00:00Z', end: '2024-01-16T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body).toHaveProperty('time_series');
    const timeSeries = body.time_series as Array<{ bucket_start: string; metrics: Record<string, unknown> }>;
    expect(timeSeries.length).toBeGreaterThan(0);
    expect(timeSeries[0]).toHaveProperty('bucket_start');
    expect(timeSeries[0]).toHaveProperty('metrics');
  });

  it('returns 403 on workspace belonging to different tenant', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: { ...sampleWorkspace, tenant_id: 'other-tenant' } });

    const res = await handleGetDashboard(makeReq({
      queryParams: { workspace_id: 'ws-1' },
    }));

    expect(res.statusCode).toBe(403);
  });

  it('returns 400 on invalid time range (start > end)', async () => {
    const res = await handleGetDashboard(makeReq({
      queryParams: { start: '2024-02-01T00:00:00Z', end: '2024-01-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('start must be before end');
  });

  it('returns 400 on invalid ISO 8601 timestamp', async () => {
    const res = await handleGetDashboard(makeReq({
      queryParams: { start: 'not-a-date', end: '2024-01-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('Invalid');
  });

  it('returns 400 on invalid range preset', async () => {
    const res = await handleGetDashboard(makeReq({
      queryParams: { range: '99d' },
    }));

    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('Invalid range');
  });

  it('returns 400 on invalid granularity value', async () => {
    setupStandardMocks();

    const res = await handleGetDashboard(makeReq({
      queryParams: { granularity: 'hourly' },
    }));

    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toContain('granularity');
  });

  it('returns cached result on repeated identical request', async () => {
    setupStandardMocks();

    const req = makeReq({
      queryParams: { workspace_id: 'ws-1', start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    });

    const res1 = await handleGetDashboard(req);
    expect(res1.statusCode).toBe(200);

    // Count how many QueryCommand calls were made for the first request
    const callsAfterFirst = ddbMock.commandCalls(QueryCommand).length;

    const res2 = await handleGetDashboard(req);
    expect(res2.statusCode).toBe(200);

    // Second call should not trigger additional DynamoDB queries (served from cache)
    const callsAfterSecond = ddbMock.commandCalls(QueryCommand).length;
    expect(callsAfterSecond).toBe(callsAfterFirst);

    expect(res2.body).toEqual(res1.body);
  });

  it('cache miss after TTL expiry', async () => {
    vi.useFakeTimers();
    try {
      setupStandardMocks();

      const req = makeReq({
        queryParams: { workspace_id: 'ws-1', start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
      });

      const res1 = await handleGetDashboard(req);
      expect(res1.statusCode).toBe(200);

      const callsAfterFirst = ddbMock.commandCalls(QueryCommand).length;

      // Advance time past the default 60s TTL
      vi.advanceTimersByTime(61_000);

      const res2 = await handleGetDashboard(req);
      expect(res2.statusCode).toBe(200);

      // After TTL expiry, new DynamoDB calls should be made
      const callsAfterSecond = ddbMock.commandCalls(QueryCommand).length;
      expect(callsAfterSecond).toBeGreaterThan(callsAfterFirst);
    } finally {
      vi.useRealTimers();
    }
  });
});


// ─── 9.2: handleGetTraceMetrics ──────────────────────────────────────────────

describe('handleGetTraceMetrics', () => {
  it('returns traces filtered by status', async () => {
    setupStandardMocks();

    const res = await handleGetTraceMetrics(makeReq({
      path: '/v1/observability/traces',
      queryParams: { status: 'failed', start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as { traces: Array<{ status: string }>; count: number };
    expect(body.traces.every((t) => t.status === 'failed')).toBe(true);
    expect(body.traces).toHaveLength(1);
  });

  it('returns traces sorted by created_at descending', async () => {
    setupStandardMocks();

    const res = await handleGetTraceMetrics(makeReq({
      path: '/v1/observability/traces',
      queryParams: { start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as { traces: Array<{ created_at: string }> };
    for (let i = 1; i < body.traces.length; i++) {
      expect(body.traces[i - 1].created_at >= body.traces[i].created_at).toBe(true);
    }
  });

  it('response includes count field', async () => {
    setupStandardMocks();

    const res = await handleGetTraceMetrics(makeReq({
      path: '/v1/observability/traces',
      queryParams: { start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as { traces: unknown[]; count: number };
    expect(body.count).toBe(body.traces.length);
  });

  it('returns 403 on other tenant workspace', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: { ...sampleWorkspace, tenant_id: 'other-tenant' } });

    const res = await handleGetTraceMetrics(makeReq({
      path: '/v1/observability/traces',
      queryParams: { workspace_id: 'ws-1' },
    }));

    expect(res.statusCode).toBe(403);
  });
});


// ─── 9.3: handleGetAgentMetrics ──────────────────────────────────────────────

describe('handleGetAgentMetrics', () => {
  it('returns agent metrics with per-model breakdowns', async () => {
    const tracesWithAgents = [
      {
        trace_id: 't-a1',
        workspace_id: 'ws-1',
        status: 'completed',
        confidence: 0.9,
        tokens: 500,
        latency: 1000,
        created_at: '2024-01-15T10:00:00Z',
        prompt_version: 'v1',
        agent_steps: [
          { agent_name: 'extraction', status: 'completed', latency: 500, input_tokens: 200, output_tokens: 100, model_id: 'claude-3-haiku' },
          { agent_name: 'extraction', status: 'completed', latency: 700, input_tokens: 300, output_tokens: 150, model_id: 'claude-3-sonnet' },
        ],
      },
    ];

    ddbMock.on(QueryCommand).callsFake((input) => {
      if (input.TableName === WORKSPACES_TABLE && input.IndexName === 'tenant-index') {
        return { Items: [sampleWorkspace] };
      }
      if (input.TableName === TRACES_TABLE && input.IndexName === 'workspace-index') {
        return { Items: tracesWithAgents };
      }
      return { Items: [] };
    });

    const res = await handleGetAgentMetrics(makeReq({
      path: '/v1/observability/agents',
      queryParams: { start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as { agents: Array<{ agent_name: string; models: Array<{ model_id: string }> }>; total_traces: number };
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].agent_name).toBe('extraction');
    expect(body.agents[0].models).toHaveLength(2);
    const modelIds = body.agents[0].models.map((m) => m.model_id);
    expect(modelIds).toContain('claude-3-haiku');
    expect(modelIds).toContain('claude-3-sonnet');
  });

  it('returns empty agents array when no agent_steps exist', async () => {
    // sampleTraces have no agent_steps
    setupStandardMocks();

    const res = await handleGetAgentMetrics(makeReq({
      path: '/v1/observability/agents',
      queryParams: { start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as { agents: unknown[]; total_traces: number };
    expect(body.agents).toHaveLength(0);
  });

  it('applies workspace filter to agent metrics', async () => {
    ddbMock.on(GetCommand, { TableName: WORKSPACES_TABLE, Key: { workspace_id: 'ws-1' } })
      .resolves({ Item: sampleWorkspace });

    ddbMock.on(QueryCommand).callsFake((input) => {
      if (input.TableName === TRACES_TABLE && input.IndexName === 'workspace-index') {
        return { Items: sampleTraces };
      }
      return { Items: [] };
    });

    const res = await handleGetAgentMetrics(makeReq({
      path: '/v1/observability/agents',
      queryParams: { workspace_id: 'ws-1', start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as { total_traces: number };
    expect(body.total_traces).toBe(3);
  });
});


// ─── 9.4: handleGetUsage ─────────────────────────────────────────────────────

describe('handleGetUsage', () => {
  it('returns usage summary with plan limits included', async () => {
    ddbMock.on(QueryCommand).callsFake((input) => {
      if (input.TableName === WORKSPACES_TABLE && input.IndexName === 'tenant-index') {
        return { Items: [sampleWorkspace] };
      }
      if (input.TableName === TRACES_TABLE && input.IndexName === 'workspace-index') {
        return { Items: sampleTraces };
      }
      if (input.TableName === SESSIONS_TABLE && input.IndexName === 'workspace-index') {
        return { Items: [] };
      }
      return { Items: [] };
    });

    ddbMock.on(GetCommand, { TableName: TENANTS_TABLE, Key: { tenant_id: 'tenant-1' } })
      .resolves({ Item: { tenant_id: 'tenant-1', email: 'test@test.com', plan: 'pro', created_at: '2024-01-01' } });

    const res = await handleGetUsage(makeReq({
      path: '/v1/observability/usage',
      queryParams: { start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as { usage: { plan: string; plan_limits: { docs_per_month: number; workspaces: number }; workspace_count: number; total_documents_processed: number; total_tokens_consumed: number } };
    expect(body.usage.plan).toBe('pro');
    expect(body.usage.plan_limits).toEqual({ docs_per_month: 500, workspaces: 20 });
    expect(body.usage.workspace_count).toBe(1);
    expect(body.usage.total_documents_processed).toBe(3);
    expect(body.usage.total_tokens_consumed).toBe(2300); // 1000 + 500 + 800
  });

  it('counts only sessions with messages as active', async () => {
    const sessionsData = [
      { session_id: 's-1', workspace_id: 'ws-1', tenant_id: 'tenant-1', title: 'Active', memory: [{ role: 'user', content: 'hi', timestamp: '2024-01-15T10:00:00Z' }], created_at: '2024-01-15T10:00:00Z' },
      { session_id: 's-2', workspace_id: 'ws-1', tenant_id: 'tenant-1', title: 'Empty', memory: [], created_at: '2024-01-15T11:00:00Z' },
      { session_id: 's-3', workspace_id: 'ws-1', tenant_id: 'tenant-1', title: 'Also Active', memory: [{ role: 'user', content: 'hello', timestamp: '2024-01-15T12:00:00Z' }], created_at: '2024-01-15T12:00:00Z' },
    ];

    ddbMock.on(QueryCommand).callsFake((input) => {
      if (input.TableName === WORKSPACES_TABLE && input.IndexName === 'tenant-index') {
        return { Items: [sampleWorkspace] };
      }
      if (input.TableName === TRACES_TABLE && input.IndexName === 'workspace-index') {
        return { Items: sampleTraces };
      }
      if (input.TableName === SESSIONS_TABLE && input.IndexName === 'workspace-index') {
        return { Items: sessionsData };
      }
      return { Items: [] };
    });

    ddbMock.on(GetCommand, { TableName: TENANTS_TABLE, Key: { tenant_id: 'tenant-1' } })
      .resolves({ Item: { tenant_id: 'tenant-1', email: 'test@test.com', plan: 'pro', created_at: '2024-01-01' } });

    const res = await handleGetUsage(makeReq({
      path: '/v1/observability/usage',
      queryParams: { start: '2024-01-01T00:00:00Z', end: '2024-02-01T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as { usage: { active_sessions_count: number } };
    expect(body.usage.active_sessions_count).toBe(2);
  });

  it('applies time-range filtering to document and token counts', async () => {
    // Only t-1 falls within the narrow range
    const narrowTraces = [
      { trace_id: 't-1', workspace_id: 'ws-1', status: 'completed', confidence: 0.9, tokens: 1000, latency: 2000, created_at: '2024-01-15T10:00:00Z', prompt_version: 'v1' },
      { trace_id: 't-old', workspace_id: 'ws-1', status: 'completed', confidence: 0.8, tokens: 2000, latency: 1500, created_at: '2024-01-01T01:00:00Z', prompt_version: 'v1' },
    ];

    ddbMock.on(QueryCommand).callsFake((input) => {
      if (input.TableName === WORKSPACES_TABLE && input.IndexName === 'tenant-index') {
        return { Items: [sampleWorkspace] };
      }
      if (input.TableName === TRACES_TABLE && input.IndexName === 'workspace-index') {
        return { Items: narrowTraces };
      }
      if (input.TableName === SESSIONS_TABLE && input.IndexName === 'workspace-index') {
        return { Items: [] };
      }
      return { Items: [] };
    });

    ddbMock.on(GetCommand, { TableName: TENANTS_TABLE, Key: { tenant_id: 'tenant-1' } })
      .resolves({ Item: { tenant_id: 'tenant-1', email: 'test@test.com', plan: 'free', created_at: '2024-01-01' } });

    const res = await handleGetUsage(makeReq({
      path: '/v1/observability/usage',
      queryParams: { start: '2024-01-15T00:00:00Z', end: '2024-01-16T00:00:00Z' },
    }));

    expect(res.statusCode).toBe(200);
    const body = res.body as { usage: { total_documents_processed: number; total_tokens_consumed: number } };
    // Only t-1 is within the range
    expect(body.usage.total_documents_processed).toBe(1);
    expect(body.usage.total_tokens_consumed).toBe(1000);
  });
});
