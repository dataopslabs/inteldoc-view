'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfidenceIndicator } from '@/components/ConfidenceIndicator';
import { Skeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useToast } from '@/components/ToastProvider';
import { api, Trace, Workspace } from '@/lib/api';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'hitl_required', label: 'HITL Required' },
];

function truncateId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) + '…' : id;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export default function TracesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // T1-02: Pagination state
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  // Build a workspace lookup map
  const workspaceMap = new Map(workspaces.map((w) => [w.workspace_id, w.name]));

  // T3-03: Use dedicated workspace traces endpoint when workspace filter is set,
  // otherwise fall back to observability traces endpoint (cross-workspace view)
  // T2-04: Server returns traces sorted newest-first (ScanIndexForward:false)
  const fetchTraces = useCallback(async (status?: string, workspaceId?: string, token?: string) => {
    if (!token) {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }
    try {
      const params: Record<string, string | undefined> = {};
      if (status) params.status = status;
      if (token) params.next_token = token;

      let result: { traces: Trace[]; count: number; next_token?: string };

      if (workspaceId) {
        // T3-03: Dedicated workspace traces endpoint — already sorted server-side
        const res = await api.traces.list(workspaceId, { status, next_token: token });
        result = res;
      } else {
        // Cross-workspace observability traces endpoint
        const res = await api.observability.traces(params);
        result = { traces: res.traces, count: res.count, next_token: res.next_token };
      }

      if (token) {
        // Append for "load more"
        setTraces((prev) => [...prev, ...result.traces]);
      } else {
        setTraces(result.traces);
      }
      setTotalCount(result.count);
      setNextToken(result.next_token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch traces';
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [showToast]);

  // Fetch workspaces on mount
  useEffect(() => {
    api.workspaces.list()
      .then((res) => setWorkspaces(res.workspaces))
      .catch(() => {/* workspace filter will just be empty */});
  }, []);

  // Fetch traces on mount and when filters change
  useEffect(() => {
    setNextToken(undefined);
    fetchTraces(statusFilter || undefined, workspaceFilter || undefined);
  }, [statusFilter, workspaceFilter, fetchTraces]);

  const handleLoadMore = () => {
    if (nextToken && !loadingMore) {
      fetchTraces(statusFilter || undefined, workspaceFilter || undefined, nextToken);
    }
  };

  const selectStyle: React.CSSProperties = {
    backgroundColor: '#2a1f3d',
    color: '#d0d6e0',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '13px',
    outline: 'none',
  };

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="Trace Explorer" />
      <div className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {/* Sentry-styled panel */}
        <ErrorBoundary section="Traces">
          <div
            className="rounded-lg overflow-hidden"
            style={{ backgroundColor: '#1a1025', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            {/* Filter bar */}
            <div
              className="flex items-center gap-4 px-5 py-3 flex-wrap"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={selectStyle}
                aria-label="Filter by status"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <select
                value={workspaceFilter}
                onChange={(e) => setWorkspaceFilter(e.target.value)}
                style={selectStyle}
                aria-label="Filter by workspace"
              >
                <option value="">All workspaces</option>
                {workspaces.map((ws) => (
                  <option key={ws.workspace_id} value={ws.workspace_id}>
                    {ws.name}
                  </option>
                ))}
              </select>

              <span className="ml-auto text-xs" style={{ color: '#62666d' }}>
                {totalCount} trace{totalCount !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Content */}
            {loading ? (
              <div className="p-5 space-y-2">
                <Skeleton variant="row" count={6} />
              </div>
            ) : error ? (
              <div className="p-5 text-center">
                <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
              </div>
            ) : traces.length === 0 ? (
              /* T4-03: Illustrated empty state */
              <div className="p-5 text-center py-16">
                <div className="text-4xl mb-3">🔍</div>
                <p className="text-sm font-medium mb-1" style={{ color: '#d0d6e0' }}>No traces found</p>
                <p className="text-xs" style={{ color: '#62666d' }}>
                  {statusFilter || workspaceFilter ? 'Try adjusting your filters' : 'Upload a document to create traces'}
                </p>
              </div>
            ) : (
              <div>
                {/* Table header */}
                <div
                  className="grid items-center px-5 py-2 text-xs font-medium"
                  style={{
                    color: '#62666d',
                    gridTemplateColumns: '120px 1fr 160px 120px 100px 160px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  <span>Trace ID</span>
                  <span>Filename</span>
                  <span>Workspace</span>
                  <span>Status</span>
                  <span>Confidence</span>
                  <span>Created</span>
                </div>

                {/* Trace rows */}
                {traces.map((trace) => (
                  <div
                    key={trace.trace_id}
                    className="grid items-center px-5 py-3 cursor-pointer transition-colors"
                    style={{
                      gridTemplateColumns: '120px 1fr 160px 120px 100px 160px',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                    }}
                    onClick={() => router.push(`/traces/${trace.trace_id}`)}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = '#2a1f3d';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/traces/${trace.trace_id}`);
                      }
                    }}
                  >
                    <span
                      className="text-xs font-mono"
                      style={{ color: '#c2ef4e' }}
                      title={trace.trace_id}
                    >
                      {truncateId(trace.trace_id)}
                    </span>
                    <span className="text-sm truncate" style={{ color: '#d0d6e0' }}>
                      {trace.filename ?? '—'}
                    </span>
                    <span className="text-xs truncate" style={{ color: '#9ca3af' }}>
                      {workspaceMap.get(trace.workspace_id) ?? truncateId(trace.workspace_id)}
                    </span>
                    <div>
                      <StatusBadge status={trace.status} size="sm" />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <ConfidenceIndicator
                        value={trace.confidence ? parseFloat(trace.confidence) : 0}
                        variant="sentry"
                        showLabel={true}
                      />
                    </div>
                    <span className="text-xs" style={{ color: '#62666d' }}>
                      {formatTimestamp(trace.created_at)}
                    </span>
                  </div>
                ))}

                {/* T1-02: Load more button */}
                {nextToken && (
                  <div className="px-5 py-3 flex justify-center" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="text-xs px-4 py-2 rounded transition-opacity disabled:opacity-50"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        color: '#d0d6e0',
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </ErrorBoundary>
      </div>
    </div>
  );
}
