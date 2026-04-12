'use client';

import { useEffect, useState, useCallback } from 'react';
import Header from '@/components/Header';
import { MetricCard } from '@/components/MetricCard';
import { Skeleton } from '@/components/Skeleton';
import { TimeRangeSelector } from '@/components/TimeRangeSelector';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  api,
  Workspace,
  DashboardResponse,
  AgentMetricsResponse,
  UsageResponse,
} from '@/lib/api';

/* ── helpers ─────────────────────────────────────────────── */

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function ms(n: number): string {
  if (n >= 60_000) return `${(n / 60_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div
      className="rounded-lg p-4 text-sm text-red-400"
      style={{
        backgroundColor: 'rgba(239,68,68,0.1)',
        border: '1px solid rgba(239,68,68,0.2)',
      }}
    >
      {message}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="text-xs font-medium mb-3 uppercase tracking-wider"
      style={{ color: '#62666d' }}
    >
      {children}
    </h3>
  );
}

function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1" style={{ color: '#8a8f98' }}>
        <span>{label}</span>
        <span>
          {fmt(value)} / {fmt(max)}
        </span>
      </div>
      <div className="h-2 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-2 rounded-full transition-all"
          style={{
            width: `${ratio * 100}%`,
            backgroundColor: ratio >= 0.9 ? '#ef4444' : '#7170ff',
          }}
        />
      </div>
    </div>
  );
}


/* ── main component ──────────────────────────────────────── */

export default function ObservabilityPage() {
  // Time range & workspace filter
  const [timeRange, setTimeRange] = useState<{ range?: string; start?: string; end?: string }>({ range: '7d' });
  const [workspaceFilter, setWorkspaceFilter] = useState<string>('');

  // Workspaces for filter dropdown
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  // Dashboard data
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Agent metrics
  const [agents, setAgents] = useState<AgentMetricsResponse | null>(null);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  // Usage data
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);

  // Build query params from current filters
  const buildParams = useCallback(() => {
    const params: Record<string, string | undefined> = {};
    if (timeRange.range) params.range = timeRange.range;
    if (timeRange.start) params.start = timeRange.start;
    if (timeRange.end) params.end = timeRange.end;
    if (workspaceFilter) params.workspace_id = workspaceFilter;
    return params;
  }, [timeRange, workspaceFilter]);

  // Fetch workspaces (once)
  useEffect(() => {
    let cancelled = false;
    api.workspaces.list()
      .then((res) => { if (!cancelled) setWorkspaces(res.workspaces); })
      .catch(() => { /* workspace filter is optional */ });
    return () => { cancelled = true; };
  }, []);

  // Fetch dashboard
  useEffect(() => {
    let cancelled = false;
    setDashboardLoading(true);
    setDashboardError(null);
    const params = buildParams();
    api.observability
      .dashboard({ ...params, group_by: 'workspace' })
      .then((res) => {
        if (!cancelled) { setDashboard(res); setDashboardLoading(false); }
      })
      .catch((err) => {
        if (!cancelled) {
          setDashboardError(err instanceof Error ? err.message : 'Failed to load dashboard');
          setDashboardLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [buildParams]);

  // Fetch agents
  useEffect(() => {
    let cancelled = false;
    setAgentsLoading(true);
    setAgentsError(null);
    const params = buildParams();
    api.observability
      .agents(params)
      .then((res) => {
        if (!cancelled) { setAgents(res); setAgentsLoading(false); }
      })
      .catch((err) => {
        if (!cancelled) {
          setAgentsError(err instanceof Error ? err.message : 'Failed to load agent metrics');
          setAgentsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [buildParams]);

  // Fetch usage
  useEffect(() => {
    let cancelled = false;
    setUsageLoading(true);
    setUsageError(null);
    const { range, start, end } = timeRange;
    api.observability
      .usage({ range, start, end })
      .then((res) => {
        if (!cancelled) { setUsage(res); setUsageLoading(false); }
      })
      .catch((err) => {
        if (!cancelled) {
          setUsageError(err instanceof Error ? err.message : 'Failed to load usage');
          setUsageLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [timeRange]);

  const d = dashboard?.dashboard;
  const h = dashboard?.hitl;

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="Observability" />
      <div className="flex-1 p-6 max-w-5xl mx-auto w-full space-y-8">
      <ErrorBoundary section="Observability">

        {/* ── Filters ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4">
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
          <select
            aria-label="Workspace filter"
            value={workspaceFilter}
            onChange={(e) => setWorkspaceFilter(e.target.value)}
            className="rounded-md px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
            style={{
              backgroundColor: '#0f1011',
              border: '1px solid rgba(255,255,255,0.06)',
              color: '#d0d6e0',
            }}
          >
            <option value="">All workspaces</option>
            {workspaces.map((ws) => (
              <option key={ws.workspace_id} value={ws.workspace_id}>
                {ws.name}
              </option>
            ))}
          </select>
        </div>

        {/* ── Summary metrics ─────────────────────────────── */}
        <section aria-label="Summary metrics">
          <SectionTitle>Summary</SectionTitle>
          {dashboardLoading ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <Skeleton variant="card" count={6} />
            </div>
          ) : dashboardError ? (
            <ErrorBox message={dashboardError} />
          ) : d ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <MetricCard label="Total traces" value={fmt(d.total_traces)} />
              <MetricCard label="Success rate" value={pct(d.success_rate)} color="#27a644" />
              <MetricCard label="Failure rate" value={pct(d.failure_rate)} color="#ef4444" />
              <MetricCard label="Avg confidence" value={pct(d.average_confidence)} />
              <MetricCard label="Avg latency" value={ms(d.average_latency_ms)} />
              <MetricCard label="Total tokens" value={fmt(d.total_tokens)} />
            </div>
          ) : null}
        </section>

        {/* ── HITL metrics ────────────────────────────────── */}
        <section aria-label="HITL metrics">
          <SectionTitle>HITL reviews</SectionTitle>
          {dashboardLoading ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Skeleton variant="card" count={4} />
            </div>
          ) : dashboardError ? (
            <ErrorBox message={dashboardError} />
          ) : h ? (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Total reviews" value={fmt(h.total_reviews)} />
              <MetricCard label="Pending" value={fmt(h.pending_count)} color="#f59e0b" />
              <MetricCard label="Avg duration" value={ms(h.average_review_duration_ms)} />
              <MetricCard label="Avg corrections" value={h.average_correction_count.toFixed(1)} />
            </div>
          ) : null}
        </section>

        {/* ── Agent performance ────────────────────────────── */}
        <section aria-label="Agent performance">
          <SectionTitle>Agent performance</SectionTitle>
          {agentsLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Skeleton variant="card" count={4} />
            </div>
          ) : agentsError ? (
            <ErrorBox message={agentsError} />
          ) : agents && agents.agents.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {agents.agents.map((a) => {
                const successRate = a.total_executions > 0 ? a.success_count / a.total_executions : 0;
                return (
                  <div
                    key={a.agent_name}
                    className="rounded-lg p-4"
                    style={{
                      backgroundColor: '#0f1011',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <p className="text-sm font-medium mb-2" style={{ color: '#d0d6e0' }}>
                      {a.agent_name}
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: '#8a8f98' }}>
                      <span>Executions</span>
                      <span className="text-right text-white">{fmt(a.total_executions)}</span>
                      <span>Success rate</span>
                      <span className="text-right text-white">{pct(successRate)}</span>
                      <span>Avg latency</span>
                      <span className="text-right text-white">{ms(a.average_latency_ms)}</span>
                      <span>Tokens (in/out)</span>
                      <span className="text-right text-white">
                        {fmt(a.total_input_tokens)} / {fmt(a.total_output_tokens)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm" style={{ color: '#8a8f98' }}>No agent data available.</p>
          )}
        </section>

        {/* ── Error analysis ──────────────────────────────── */}
        <section aria-label="Error analysis">
          <SectionTitle>Error analysis</SectionTitle>
          {dashboardLoading ? (
            <Skeleton variant="row" count={3} />
          ) : dashboardError ? (
            <ErrorBox message={dashboardError} />
          ) : dashboard && dashboard.error_analysis.length > 0 ? (
            <div
              className="rounded-lg overflow-hidden"
              style={{
                backgroundColor: '#0f1011',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th className="text-left px-4 py-2 font-medium" style={{ color: '#62666d' }}>
                      Error
                    </th>
                    <th className="text-right px-4 py-2 font-medium" style={{ color: '#62666d' }}>
                      Count
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.error_analysis.map((e, i) => (
                    <tr
                      key={i}
                      style={
                        i < dashboard.error_analysis.length - 1
                          ? { borderBottom: '1px solid rgba(255,255,255,0.04)' }
                          : undefined
                      }
                    >
                      <td className="px-4 py-2 text-red-400 truncate max-w-xs">
                        {e.error_message}
                      </td>
                      <td className="px-4 py-2 text-right text-white">{e.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm" style={{ color: '#8a8f98' }}>No errors recorded.</p>
          )}
        </section>

        {/* ── Usage ───────────────────────────────────────── */}
        <section aria-label="Usage">
          <SectionTitle>Usage</SectionTitle>
          {usageLoading ? (
            <Skeleton variant="card" count={1} />
          ) : usageError ? (
            <ErrorBox message={usageError} />
          ) : usage ? (
            <div
              className="rounded-lg p-4"
              style={{
                backgroundColor: '#0f1011',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <ProgressBar
                label="Documents processed"
                value={usage.usage.total_documents_processed}
                max={usage.usage.plan_limits.docs_per_month}
              />
              {/* T1-05: Use actual tokens_per_month from plan_limits (not docs * 5000 proxy) */}
              <ProgressBar
                label="Tokens consumed"
                value={usage.usage.total_tokens_consumed}
                max={usage.usage.plan_limits.tokens_per_month ?? usage.usage.plan_limits.docs_per_month * 5000}
              />
              <div className="flex justify-between text-xs mt-2" style={{ color: '#8a8f98' }}>
                <span>Plan: {usage.usage.plan}</span>
                <span>
                  {usage.usage.workspace_count} / {usage.usage.plan_limits.workspaces} workspaces
                </span>
              </div>
            </div>
          ) : null}
        </section>

        {/* ── Workspace breakdown ─────────────────────────── */}
        {dashboard?.workspaces && dashboard.workspaces.length > 0 && (
          <section aria-label="Workspace breakdown">
            <SectionTitle>Workspace breakdown</SectionTitle>
            <div
              className="rounded-lg overflow-hidden"
              style={{
                backgroundColor: '#0f1011',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th className="text-left px-4 py-2 font-medium" style={{ color: '#62666d' }}>Workspace</th>
                    <th className="text-right px-4 py-2 font-medium" style={{ color: '#62666d' }}>Traces</th>
                    <th className="text-right px-4 py-2 font-medium" style={{ color: '#62666d' }}>Success</th>
                    <th className="text-right px-4 py-2 font-medium" style={{ color: '#62666d' }}>Avg conf.</th>
                    <th className="text-right px-4 py-2 font-medium" style={{ color: '#62666d' }}>Avg latency</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.workspaces.map((w, i) => (
                    <tr
                      key={w.workspace_id}
                      style={
                        i < (dashboard.workspaces?.length ?? 0) - 1
                          ? { borderBottom: '1px solid rgba(255,255,255,0.04)' }
                          : undefined
                      }
                    >
                      <td className="px-4 py-2" style={{ color: '#d0d6e0' }}>{w.workspace_name}</td>
                      <td className="px-4 py-2 text-right text-white">{fmt(w.metrics.total_traces)}</td>
                      <td className="px-4 py-2 text-right text-white">{pct(w.metrics.success_rate)}</td>
                      <td className="px-4 py-2 text-right text-white">{pct(w.metrics.average_confidence)}</td>
                      <td className="px-4 py-2 text-right text-white">{ms(w.metrics.average_latency_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </ErrorBoundary>
      </div>
    </div>
  );
}
