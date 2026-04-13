import type {
  Trace,
  HitlReview,
  DashboardMetrics,
  HitlMetrics,
  AgentMetrics,
  ErrorGroup,
  TimeSeriesBucket,
  WorkspaceMetricsGroup,
  UsageSummary,
} from '../models/types';

// --- 3.1: resolveTimeRange and filterByTimeRange ---

const VALID_RANGES: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function resolveTimeRange(params: {
  range?: string;
  start?: string;
  end?: string;
}): { startDate: Date; endDate: Date } {
  if (params.start && params.end) {
    const startDate = new Date(params.start);
    const endDate = new Date(params.end);
    if (isNaN(startDate.getTime())) {
      throw new Error('Invalid start: must be a valid ISO 8601 timestamp');
    }
    if (isNaN(endDate.getTime())) {
      throw new Error('Invalid end: must be a valid ISO 8601 timestamp');
    }
    if (startDate > endDate) {
      throw new Error('Invalid time range: start must be before end');
    }
    return { startDate, endDate };
  }

  if (params.start && !params.end) {
    const startDate = new Date(params.start);
    if (isNaN(startDate.getTime())) {
      throw new Error('Invalid start: must be a valid ISO 8601 timestamp');
    }
    throw new Error('Invalid end: must be a valid ISO 8601 timestamp');
  }

  if (!params.start && params.end) {
    const endDate = new Date(params.end);
    if (isNaN(endDate.getTime())) {
      throw new Error('Invalid end: must be a valid ISO 8601 timestamp');
    }
    throw new Error('Invalid start: must be a valid ISO 8601 timestamp');
  }

  if (params.range) {
    const ms = VALID_RANGES[params.range];
    if (ms === undefined) {
      throw new Error('Invalid range: must be one of 24h, 7d, 30d');
    }
    const now = new Date();
    return { startDate: new Date(now.getTime() - ms), endDate: now };
  }

  // Default: last 30 days
  const now = new Date();
  return { startDate: new Date(now.getTime() - VALID_RANGES['30d']), endDate: now };
}

export function filterByTimeRange<T extends { created_at: string }>(
  records: T[],
  startDate: Date,
  endDate: Date
): T[] {
  return records.filter((r) => {
    const t = new Date(r.created_at).getTime();
    return t >= startDate.getTime() && t <= endDate.getTime();
  });
}


// --- 3.2: computeDashboardMetrics ---

export function computeDashboardMetrics(traces: Trace[]): DashboardMetrics {
  const total_traces = traces.length;
  let success_count = 0;
  let failure_count = 0;
  let hitl_required_count = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let total_tokens = 0;

  for (const t of traces) {
    if (t.status === 'completed') success_count++;
    else if (t.status === 'failed') failure_count++;
    else if (t.status === 'hitl_required') hitl_required_count++;

    if (t.confidence != null) {
      confidenceSum += t.confidence;
      confidenceCount++;
    }
    if (t.latency != null) {
      latencySum += t.latency;
      latencyCount++;
    }
    total_tokens += t.tokens ?? 0;
  }

  return {
    total_traces,
    success_count,
    failure_count,
    hitl_required_count,
    success_rate: total_traces === 0 ? 0 : success_count / total_traces,
    failure_rate: total_traces === 0 ? 0 : failure_count / total_traces,
    average_confidence: confidenceCount === 0 ? 0 : confidenceSum / confidenceCount,
    average_latency_ms: latencyCount === 0 ? 0 : latencySum / latencyCount,
    total_tokens,
  };
}

// --- 3.3: computeHitlMetrics ---

export function computeHitlMetrics(reviews: HitlReview[]): HitlMetrics {
  let pending_count = 0;
  let in_review_count = 0;
  let resolved_count = 0;
  let durationSum = 0;
  let durationCount = 0;
  let correctionSum = 0;
  let correctionCount = 0;

  for (const r of reviews) {
    if (r.status === 'pending') pending_count++;
    else if (r.status === 'in_review') in_review_count++;
    else if (r.status === 'resolved') {
      resolved_count++;
      if (r.review_duration_ms != null) {
        durationSum += r.review_duration_ms;
        durationCount++;
      }
      if (r.correction_count != null) {
        correctionSum += r.correction_count;
        correctionCount++;
      }
    }
  }

  return {
    total_reviews: reviews.length,
    pending_count,
    in_review_count,
    resolved_count,
    average_review_duration_ms: durationCount === 0 ? 0 : durationSum / durationCount,
    average_correction_count: correctionCount === 0 ? 0 : correctionSum / correctionCount,
  };
}


// --- 3.4: computeAgentMetrics ---

interface AgentStep {
  agent_name: string;
  status?: string;
  latency?: number;
  input_tokens?: number;
  output_tokens?: number;
  model_id?: string;
}

export function computeAgentMetrics(traces: Trace[]): AgentMetrics[] {
  const allSteps: AgentStep[] = [];
  for (const trace of traces) {
    if (trace.agent_steps && trace.agent_steps.length > 0) {
      for (const step of trace.agent_steps) {
        allSteps.push(step as AgentStep);
      }
    }
  }

  if (allSteps.length === 0) return [];

  const agentMap = new Map<
    string,
    {
      total_executions: number;
      success_count: number;
      error_count: number;
      latencySum: number;
      latencyCount: number;
      total_input_tokens: number;
      total_output_tokens: number;
      models: Map<string, { execution_count: number; latencySum: number; latencyCount: number }>;
    }
  >();

  for (const step of allSteps) {
    const name = step.agent_name;
    if (!agentMap.has(name)) {
      agentMap.set(name, {
        total_executions: 0,
        success_count: 0,
        error_count: 0,
        latencySum: 0,
        latencyCount: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        models: new Map(),
      });
    }
    const agg = agentMap.get(name)!;
    agg.total_executions++;
    if (step.status === 'completed') agg.success_count++;
    if (step.status === 'failed') agg.error_count++;
    if (step.latency != null) {
      agg.latencySum += step.latency;
      agg.latencyCount++;
    }
    agg.total_input_tokens += step.input_tokens ?? 0;
    agg.total_output_tokens += step.output_tokens ?? 0;

    const modelId = step.model_id ?? 'unknown';
    if (!agg.models.has(modelId)) {
      agg.models.set(modelId, { execution_count: 0, latencySum: 0, latencyCount: 0 });
    }
    const m = agg.models.get(modelId)!;
    m.execution_count++;
    if (step.latency != null) {
      m.latencySum += step.latency;
      m.latencyCount++;
    }
  }

  const result: AgentMetrics[] = [];
  for (const [agent_name, agg] of agentMap) {
    const models: AgentMetrics['models'] = [];
    for (const [model_id, m] of agg.models) {
      models.push({
        model_id,
        execution_count: m.execution_count,
        average_latency_ms: m.latencyCount === 0 ? 0 : m.latencySum / m.latencyCount,
      });
    }
    result.push({
      agent_name,
      total_executions: agg.total_executions,
      success_count: agg.success_count,
      error_count: agg.error_count,
      average_latency_ms: agg.latencyCount === 0 ? 0 : agg.latencySum / agg.latencyCount,
      total_input_tokens: agg.total_input_tokens,
      total_output_tokens: agg.total_output_tokens,
      models,
    });
  }

  return result;
}


// --- 3.5: computeErrorAnalysis ---

export function computeErrorAnalysis(traces: Trace[], limit = 10): ErrorGroup[] {
  const failed = traces.filter((t) => t.status === 'failed');
  if (failed.length === 0) return [];

  const counts = new Map<string, number>();
  for (const t of failed) {
    const msg = t.error ?? 'Unknown error';
    counts.set(msg, (counts.get(msg) ?? 0) + 1);
  }

  const groups: ErrorGroup[] = [];
  for (const [error_message, count] of counts) {
    groups.push({ error_message, count });
  }

  groups.sort((a, b) => b.count - a.count);
  return groups.slice(0, limit);
}


// --- 3.6: computeTimeSeries ---

function toUTCDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMondayOfWeek(d: Date): Date {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayOfWeek = copy.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // days since Monday
  copy.setUTCDate(copy.getUTCDate() - diff);
  return copy;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d.getTime());
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

function emptyDashboardMetrics(): DashboardMetrics {
  return {
    total_traces: 0,
    success_count: 0,
    failure_count: 0,
    hitl_required_count: 0,
    success_rate: 0,
    failure_rate: 0,
    average_confidence: 0,
    average_latency_ms: 0,
    total_tokens: 0,
  };
}

export function computeTimeSeries(
  traces: Trace[],
  granularity: 'daily' | 'weekly',
  startDate: Date,
  endDate: Date
): TimeSeriesBucket[] {
  // Build bucket keys for the full range
  const bucketKeys: string[] = [];

  if (granularity === 'daily') {
    let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
    const endDay = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
    while (cursor <= endDay) {
      bucketKeys.push(toUTCDateString(cursor));
      cursor = addDays(cursor, 1);
    }
  } else {
    // weekly
    let cursor = getMondayOfWeek(startDate);
    const endDay = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
    while (cursor <= endDay) {
      bucketKeys.push(toUTCDateString(cursor));
      cursor = addDays(cursor, 7);
    }
  }

  // Group traces into buckets
  const bucketTraces = new Map<string, Trace[]>();
  for (const key of bucketKeys) {
    bucketTraces.set(key, []);
  }

  for (const trace of traces) {
    const d = new Date(trace.created_at);
    let key: string;
    if (granularity === 'daily') {
      key = toUTCDateString(d);
    } else {
      key = toUTCDateString(getMondayOfWeek(d));
    }
    const arr = bucketTraces.get(key);
    if (arr) {
      arr.push(trace);
    }
  }

  return bucketKeys.map((key) => ({
    bucket_start: key,
    metrics: computeDashboardMetrics(bucketTraces.get(key) ?? []),
  }));
}


// --- 3.7: groupByWorkspace and computeUsageSummary ---

export function groupByWorkspace(
  traces: Trace[],
  workspaceNames: Map<string, string>
): WorkspaceMetricsGroup[] {
  const groups = new Map<string, Trace[]>();
  for (const trace of traces) {
    const wsId = trace.workspace_id;
    if (!groups.has(wsId)) {
      groups.set(wsId, []);
    }
    groups.get(wsId)!.push(trace);
  }

  const result: WorkspaceMetricsGroup[] = [];
  for (const [workspace_id, wsTraces] of groups) {
    result.push({
      workspace_id,
      workspace_name: workspaceNames.get(workspace_id) ?? workspace_id,
      metrics: computeDashboardMetrics(wsTraces),
    });
  }

  return result;
}

export function computeUsageSummary(
  traces: Trace[],
  workspaceCount: number,
  activeSessions: number,
  plan: string,
  planLimits: { docs_per_month: number; workspaces: number; tokens_per_month?: number; chats_per_month?: number }
): UsageSummary {
  let total_tokens_consumed = 0;
  for (const t of traces) {
    total_tokens_consumed += t.tokens ?? 0;
  }

  return {
    total_documents_processed: traces.length,
    total_tokens_consumed,
    workspace_count: workspaceCount,
    active_sessions_count: activeSessions,
    plan,
    plan_limits: {
      docs_per_month: planLimits.docs_per_month,
      workspaces: planLimits.workspaces,
      tokens_per_month: planLimits.tokens_per_month ?? 0,
      chats_per_month: planLimits.chats_per_month ?? 0,
    },
  };
}
