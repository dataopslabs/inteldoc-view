'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { MetricCard } from '@/components/MetricCard';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfidenceIndicator } from '@/components/ConfidenceIndicator';
import { Skeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { api, Workspace, Trace, UsageResponse } from '@/lib/api';

// T4-07: Configurable recent activity time ranges
const RANGE_OPTIONS = [
  { value: '1d', label: 'Last 24h' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

export default function DashboardPage() {
  const router = useRouter();

  // T4-07: Recent activity range state (user-configurable)
  const [activityRange, setActivityRange] = useState('7d');

  // Workspaces state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspacesError, setWorkspacesError] = useState<string | null>(null);

  // Usage state
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);

  // Traces state
  const [traces, setTraces] = useState<Trace[]>([]);
  const [tracesLoading, setTracesLoading] = useState(true);
  const [tracesError, setTracesError] = useState<string | null>(null);

  // Fetch workspaces
  useEffect(() => {
    let cancelled = false;
    api.workspaces.list()
      .then((res) => {
        if (!cancelled) {
          setWorkspaces(res.workspaces);
          setWorkspacesLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setWorkspacesError(err instanceof Error ? err.message : 'Failed to load workspaces');
          setWorkspacesLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  // Fetch usage
  useEffect(() => {
    let cancelled = false;
    api.observability.usage()
      .then((res) => {
        if (!cancelled) {
          setUsage(res);
          setUsageLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setUsageError(err instanceof Error ? err.message : 'Failed to load usage');
          setUsageLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  // T4-07: Fetch recent traces — re-fetches when activityRange changes
  useEffect(() => {
    let cancelled = false;
    setTracesLoading(true);
    setTracesError(null);
    api.observability.traces({ range: activityRange })
      .then((res) => {
        if (!cancelled) {
          setTraces(res.traces.slice(0, 5));
          setTracesLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setTracesError(err instanceof Error ? err.message : 'Failed to load traces');
          setTracesLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [activityRange]);

  function formatTimestamp(ts: string): string {
    try {
      return new Date(ts).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return ts;
    }
  }

  function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="Dashboard" />
      <div className="flex-1 p-6 max-w-5xl mx-auto w-full">

        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-xl font-semibold mb-1" style={{ color: '#f7f8f8', letterSpacing: '-0.02em' }}>
            Welcome to DocOps
          </h2>
          <p className="text-sm" style={{ color: '#8a8f98' }}>
            Agentic Document Intelligence Platform
          </p>
        </div>

        {/* Usage stats row */}
        <ErrorBoundary section="Usage Overview">
          <section className="mb-8" aria-label="Usage statistics">
            <h3 className="text-xs font-medium mb-3 uppercase tracking-wider" style={{ color: '#62666d' }}>
              Usage overview
            </h3>
            {usageLoading ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Skeleton variant="card" count={4} />
              </div>
            ) : usageError ? (
              <div className="rounded-lg p-4 text-sm text-red-400" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                {usageError}
              </div>
            ) : usage ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricCard
                  label="Workspaces"
                  value={usage.usage.workspace_count}
                  subtitle={`/ ${usage.usage.plan_limits.workspaces} limit`}
                />
                <MetricCard
                  label="Docs processed"
                  value={formatNumber(usage.usage.total_documents_processed)}
                  subtitle={`/ ${formatNumber(usage.usage.plan_limits.docs_per_month)} this month`}
                />
                <MetricCard
                  label="Tokens consumed"
                  value={formatNumber(usage.usage.total_tokens_consumed)}
                />
                <MetricCard
                  label="Plan"
                  value={usage.usage.plan}
                  subtitle={`${usage.usage.active_sessions_count} active sessions`}
                />
              </div>
            ) : null}
          </section>
        </ErrorBoundary>

        {/* Workspace cards grid */}
        <ErrorBoundary section="Workspaces">
          <section className="mb-8" aria-label="Workspaces">
            <h3 className="text-xs font-medium mb-3 uppercase tracking-wider" style={{ color: '#62666d' }}>
              Workspaces
            </h3>
            {workspacesLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Skeleton variant="card" count={3} />
              </div>
            ) : workspacesError ? (
              <div className="rounded-lg p-4 text-sm text-red-400" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                {workspacesError}
              </div>
            ) : workspaces.length === 0 ? (
              /* T4-03: Illustrated empty state */
              <div className="rounded-lg p-6 text-center" style={{ backgroundColor: '#0f1011', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-3xl mb-2">🗂️</div>
                <p className="text-sm font-medium mb-1" style={{ color: '#d0d6e0' }}>No workspaces yet</p>
                <button
                  onClick={() => router.push('/workspaces')}
                  className="mt-2 text-sm font-medium"
                  style={{ color: '#7170ff', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Create your first workspace →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {workspaces.map((ws) => (
                  <button
                    key={ws.workspace_id}
                    onClick={() => router.push(`/workspaces/${ws.workspace_id}`)}
                    className="text-left rounded-lg p-4 transition-colors hover:border-indigo-500/30"
                    style={{
                      backgroundColor: '#0f1011',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="text-sm font-medium mb-1" style={{ color: '#d0d6e0' }}>
                      {ws.name}
                    </div>
                    {ws.description && (
                      <div className="text-xs mb-2 line-clamp-2" style={{ color: '#62666d' }}>
                        {ws.description}
                      </div>
                    )}
                    <div className="text-xs" style={{ color: '#62666d' }}>
                      Created {formatTimestamp(ws.created_at)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </ErrorBoundary>

        {/* Recent activity */}
        <ErrorBoundary section="Recent Activity">
          <section aria-label="Recent activity">
            {/* T4-07: Range selector in section header */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: '#62666d' }}>
                Recent activity
              </h3>
              <div className="flex gap-1">
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setActivityRange(opt.value)}
                    className="text-xs px-2 py-1 rounded transition-colors"
                    style={{
                      backgroundColor: activityRange === opt.value ? 'rgba(113,112,255,0.15)' : 'transparent',
                      color: activityRange === opt.value ? '#7170ff' : '#62666d',
                      border: activityRange === opt.value ? '1px solid rgba(113,112,255,0.3)' : '1px solid transparent',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {tracesLoading ? (
              <div className="space-y-2">
                <Skeleton variant="row" count={5} />
              </div>
            ) : tracesError ? (
              <div className="rounded-lg p-4 text-sm text-red-400" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
                {tracesError}
              </div>
            ) : traces.length === 0 ? (
              <div className="rounded-lg p-6 text-center" style={{ backgroundColor: '#0f1011', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-3xl mb-2">📄</div>
                <p className="text-sm" style={{ color: '#8a8f98' }}>
                  No activity in the {RANGE_OPTIONS.find(o => o.value === activityRange)?.label.toLowerCase() ?? activityRange}.
                </p>
              </div>
            ) : (
              <div className="rounded-lg overflow-hidden" style={{ backgroundColor: '#0f1011', border: '1px solid rgba(255,255,255,0.06)' }}>
                {traces.map((trace, idx) => (
                  <button
                    key={trace.trace_id}
                    onClick={() => router.push(`/traces/${trace.trace_id}`)}
                    className="w-full flex items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                    style={idx < traces.length - 1 ? { borderBottom: '1px solid rgba(255,255,255,0.04)' } : undefined}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: '#d0d6e0' }}>
                        {trace.filename ?? trace.trace_id.slice(0, 12)}
                      </div>
                      <div className="text-xs" style={{ color: '#62666d' }}>
                        {formatTimestamp(trace.created_at)}
                      </div>
                    </div>
                    <StatusBadge status={trace.status} size="sm" />
                    {trace.confidence != null && (
                      <div className="w-24">
                        <ConfidenceIndicator value={parseFloat(String(trace.confidence))} showLabel />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        </ErrorBoundary>

      </div>
    </div>
  );
}
