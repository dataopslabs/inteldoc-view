import {
  ApiRequest,
  ApiResponse,
  Trace,
  HitlReview,
  Workspace,
  Session,
  Tenant,
  PLAN_LIMITS,
} from '../models/types';
import { getItem, queryIndex, queryAllForWorkspaces, TABLE_NAMES } from '../lib/dynamo';
import {
  resolveTimeRange,
  filterByTimeRange,
  computeDashboardMetrics,
  computeHitlMetrics,
  computeAgentMetrics,
  computeErrorAnalysis,
  computeTimeSeries,
  groupByWorkspace,
  computeUsageSummary,
} from '../lib/metrics-engine';
import { metricsCache } from '../lib/metrics-cache';

// T4-03: Exported helper so write-path handlers (process, hitl, workspace) can
// invalidate the metrics cache when they mutate data that observability reads.
// This prevents stale dashboards after document uploads or HITL resolutions.
export function invalidateMetricsCache(tenantId: string): void {
  metricsCache.invalidate(tenantId);
}

/**
 * GET /v1/observability
 * Query params: range, start, end, workspace_id, group_by, granularity
 */
export async function handleGetDashboard(req: ApiRequest): Promise<ApiResponse> {
  const tenantId = req.context.tenantId;
  const cacheKey = metricsCache.buildKey(tenantId, '/v1/observability', req.queryParams ?? {});

  const cached = metricsCache.get<unknown>(cacheKey);
  if (cached !== null) {
    return { statusCode: 200, body: cached };
  }

  let startDate: Date;
  let endDate: Date;
  try {
    const resolved = resolveTimeRange({
      range: req.queryParams?.range,
      start: req.queryParams?.start,
      end: req.queryParams?.end,
    });
    startDate = resolved.startDate;
    endDate = resolved.endDate;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid time range';
    return { statusCode: 400, body: { error: message } };
  }

  const granularity = req.queryParams?.granularity;
  if (granularity && granularity !== 'daily' && granularity !== 'weekly') {
    return { statusCode: 400, body: { error: 'Invalid granularity: must be daily or weekly' } };
  }

  let workspaceIds: string[];

  try {
    if (req.queryParams?.workspace_id) {
      const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, {
        workspace_id: req.queryParams.workspace_id,
      });
      if (!workspace) {
        return { statusCode: 404, body: { error: 'Workspace not found' } };
      }
      if (workspace.tenant_id !== tenantId) {
        return { statusCode: 403, body: { error: 'Forbidden' } };
      }
      workspaceIds = [req.queryParams.workspace_id];
    } else {
      const workspaces = await queryIndex<Workspace>(
        TABLE_NAMES.workspaces,
        'tenant-index',
        'tenant_id',
        tenantId,
      );
      workspaceIds = workspaces.map((w) => w.workspace_id);
    }

    const traces = await queryAllForWorkspaces<Trace>(
      TABLE_NAMES.traces,
      'workspace-index',
      workspaceIds,
    );
    const filteredTraces = filterByTimeRange(traces, startDate, endDate);

    const dashboard = computeDashboardMetrics(filteredTraces);

    const reviews = await queryAllForWorkspaces<HitlReview>(
      TABLE_NAMES.hitlReviews,
      'workspace-index',
      workspaceIds,
    );
    const filteredReviews = filterByTimeRange(reviews, startDate, endDate);
    const hitl = computeHitlMetrics(filteredReviews);

    const error_analysis = computeErrorAnalysis(filteredTraces);

    const body: Record<string, unknown> = {
      dashboard,
      hitl,
      error_analysis,
      time_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    };

    if (req.queryParams?.group_by === 'workspace') {
      const workspaces = await queryIndex<Workspace>(
        TABLE_NAMES.workspaces,
        'tenant-index',
        'tenant_id',
        tenantId,
      );
      const nameMap = new Map<string, string>();
      for (const ws of workspaces) {
        nameMap.set(ws.workspace_id, ws.name);
      }
      body.workspaces = groupByWorkspace(filteredTraces, nameMap);
    }

    if (granularity === 'daily' || granularity === 'weekly') {
      body.time_series = computeTimeSeries(filteredTraces, granularity, startDate, endDate);
    }

    metricsCache.set(cacheKey, body);
    return { statusCode: 200, body };
  } catch {
    return { statusCode: 500, body: { error: 'Failed to fetch metrics' } };
  }
}


/**
 * GET /v1/observability/traces
 * Query params: range, start, end, workspace_id, status
 */
export async function handleGetTraceMetrics(req: ApiRequest): Promise<ApiResponse> {
  const tenantId = req.context.tenantId;
  const cacheKey = metricsCache.buildKey(tenantId, '/v1/observability/traces', req.queryParams ?? {});

  const cached = metricsCache.get<unknown>(cacheKey);
  if (cached !== null) {
    return { statusCode: 200, body: cached };
  }

  let startDate: Date;
  let endDate: Date;
  try {
    const resolved = resolveTimeRange({
      range: req.queryParams?.range,
      start: req.queryParams?.start,
      end: req.queryParams?.end,
    });
    startDate = resolved.startDate;
    endDate = resolved.endDate;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid time range';
    return { statusCode: 400, body: { error: message } };
  }

  let workspaceIds: string[];

  try {
    if (req.queryParams?.workspace_id) {
      const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, {
        workspace_id: req.queryParams.workspace_id,
      });
      if (!workspace) {
        return { statusCode: 404, body: { error: 'Workspace not found' } };
      }
      if (workspace.tenant_id !== tenantId) {
        return { statusCode: 403, body: { error: 'Forbidden' } };
      }
      workspaceIds = [req.queryParams.workspace_id];
    } else {
      const workspaces = await queryIndex<Workspace>(
        TABLE_NAMES.workspaces,
        'tenant-index',
        'tenant_id',
        tenantId,
      );
      workspaceIds = workspaces.map((w) => w.workspace_id);
    }

    const traces = await queryAllForWorkspaces<Trace>(
      TABLE_NAMES.traces,
      'workspace-index',
      workspaceIds,
    );
    let filteredTraces = filterByTimeRange(traces, startDate, endDate);

    if (req.queryParams?.status) {
      filteredTraces = filteredTraces.filter((t) => t.status === req.queryParams.status);
    }

    filteredTraces.sort((a, b) => b.created_at.localeCompare(a.created_at));

    // G5-21: Cursor-based pagination for the observability traces list
    const pageSize = Math.min(parseInt(req.queryParams?.limit ?? '50', 10) || 50, 200);
    const nextToken = req.queryParams?.next_token;
    let startIdx = 0;
    if (nextToken) {
      try {
        startIdx = parseInt(Buffer.from(nextToken, 'base64').toString('utf8'), 10) || 0;
      } catch {
        startIdx = 0;
      }
    }
    const pageTraces = filteredTraces.slice(startIdx, startIdx + pageSize);
    const hasMore = startIdx + pageSize < filteredTraces.length;
    const newNextToken = hasMore
      ? Buffer.from(String(startIdx + pageSize)).toString('base64')
      : undefined;

    const body = {
      traces: pageTraces,
      count: pageTraces.length,
      total: filteredTraces.length,
      next_token: newNextToken,
      time_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    };

    metricsCache.set(cacheKey, body);
    return { statusCode: 200, body };
  } catch {
    return { statusCode: 500, body: { error: 'Failed to fetch metrics' } };
  }
}


/**
 * GET /v1/observability/agents
 * Query params: range, start, end, workspace_id
 */
export async function handleGetAgentMetrics(req: ApiRequest): Promise<ApiResponse> {
  const tenantId = req.context.tenantId;
  const cacheKey = metricsCache.buildKey(tenantId, '/v1/observability/agents', req.queryParams ?? {});

  const cached = metricsCache.get<unknown>(cacheKey);
  if (cached !== null) {
    return { statusCode: 200, body: cached };
  }

  let startDate: Date;
  let endDate: Date;
  try {
    const resolved = resolveTimeRange({
      range: req.queryParams?.range,
      start: req.queryParams?.start,
      end: req.queryParams?.end,
    });
    startDate = resolved.startDate;
    endDate = resolved.endDate;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid time range';
    return { statusCode: 400, body: { error: message } };
  }

  let workspaceIds: string[];

  try {
    if (req.queryParams?.workspace_id) {
      const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, {
        workspace_id: req.queryParams.workspace_id,
      });
      if (!workspace) {
        return { statusCode: 404, body: { error: 'Workspace not found' } };
      }
      if (workspace.tenant_id !== tenantId) {
        return { statusCode: 403, body: { error: 'Forbidden' } };
      }
      workspaceIds = [req.queryParams.workspace_id];
    } else {
      const workspaces = await queryIndex<Workspace>(
        TABLE_NAMES.workspaces,
        'tenant-index',
        'tenant_id',
        tenantId,
      );
      workspaceIds = workspaces.map((w) => w.workspace_id);
    }

    const traces = await queryAllForWorkspaces<Trace>(
      TABLE_NAMES.traces,
      'workspace-index',
      workspaceIds,
    );
    const filteredTraces = filterByTimeRange(traces, startDate, endDate);

    const agents = computeAgentMetrics(filteredTraces);

    const body = {
      agents,
      total_traces: filteredTraces.length,
      time_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    };

    metricsCache.set(cacheKey, body);
    return { statusCode: 200, body };
  } catch {
    return { statusCode: 500, body: { error: 'Failed to fetch metrics' } };
  }
}


/**
 * GET /v1/observability/usage
 * Query params: range, start, end
 */
export async function handleGetUsage(req: ApiRequest): Promise<ApiResponse> {
  const tenantId = req.context.tenantId;
  const cacheKey = metricsCache.buildKey(tenantId, '/v1/observability/usage', req.queryParams ?? {});

  const cached = metricsCache.get<unknown>(cacheKey);
  if (cached !== null) {
    return { statusCode: 200, body: cached };
  }

  let startDate: Date;
  let endDate: Date;
  try {
    const resolved = resolveTimeRange({
      range: req.queryParams?.range,
      start: req.queryParams?.start,
      end: req.queryParams?.end,
    });
    startDate = resolved.startDate;
    endDate = resolved.endDate;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid time range';
    return { statusCode: 400, body: { error: message } };
  }

  try {
    const workspaces = await queryIndex<Workspace>(
      TABLE_NAMES.workspaces,
      'tenant-index',
      'tenant_id',
      tenantId,
    );
    const workspaceIds = workspaces.map((w) => w.workspace_id);

    const traces = await queryAllForWorkspaces<Trace>(
      TABLE_NAMES.traces,
      'workspace-index',
      workspaceIds,
    );
    const filteredTraces = filterByTimeRange(traces, startDate, endDate);

    const sessions = await queryAllForWorkspaces<Session>(
      TABLE_NAMES.sessions,
      'workspace-index',
      workspaceIds,
    );
    const activeSessions = sessions.filter(
      (s) => Array.isArray(s.memory) && s.memory.length > 0,
    ).length;

    const tenant = await getItem<Tenant>(TABLE_NAMES.tenants, { tenant_id: tenantId });
    const plan = tenant?.plan ?? 'free';
    const planLimits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;

    const usage = computeUsageSummary(
      filteredTraces,
      workspaces.length,
      activeSessions,
      plan,
      planLimits,
    );

    const body = {
      usage,
      time_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
    };

    metricsCache.set(cacheKey, body);
    return { statusCode: 200, body };
  } catch {
    return { statusCode: 500, body: { error: 'Failed to fetch metrics' } };
  }
}
