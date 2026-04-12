'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useToast } from '@/components/ToastProvider';
import { api, HitlReview, Workspace } from '@/lib/api';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_review', label: 'In Review' },
  { value: 'resolved', label: 'Resolved' },
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

export default function HitlQueuePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [reviews, setReviews] = useState<HitlReview[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // T1-02: Pagination state
  const [nextToken, setNextToken] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const workspaceMap = new Map(workspaces.map((w) => [w.workspace_id, w.name]));

  // Compute status counts from the current reviews list
  const statusCounts = reviews.reduce(
    (acc, r) => {
      if (r.status === 'pending') acc.pending++;
      else if (r.status === 'in_review') acc.in_review++;
      else if (r.status === 'resolved') acc.resolved++;
      return acc;
    },
    { pending: 0, in_review: 0, resolved: 0 }
  );

  const fetchReviews = useCallback(async (status?: string, workspaceId?: string, token?: string) => {
    if (!token) {
      setLoading(true);
      setError(null);
    } else {
      setLoadingMore(true);
    }
    try {
      const params: Record<string, string | undefined> = {};
      if (status) params.status = status;
      if (workspaceId) params.workspace_id = workspaceId;
      if (token) params.next_token = token;
      const res = await api.hitl.list(params);

      if (token) {
        // Append for "load more"
        setReviews((prev) => [...prev, ...res.reviews]);
      } else {
        setReviews(res.reviews);
      }
      setTotalCount(res.count);
      setNextToken((res as { next_token?: string }).next_token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch reviews';
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

  // Fetch reviews on mount and when filters change
  useEffect(() => {
    setNextToken(undefined);
    fetchReviews(statusFilter || undefined, workspaceFilter || undefined);
  }, [statusFilter, workspaceFilter, fetchReviews]);

  const handleLoadMore = () => {
    if (nextToken && !loadingMore) {
      fetchReviews(statusFilter || undefined, workspaceFilter || undefined, nextToken);
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

  const pillStyle = (color: string): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 12px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: 500,
    backgroundColor: `${color}1a`,
    color: color,
  });

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="HITL Review Queue" />
      <div className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {/* Status summary bar */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span style={pillStyle('#62666d')}>
            Pending <strong>{statusCounts.pending}</strong>
          </span>
          <span style={pillStyle('#f59e0b')}>
            In Review <strong>{statusCounts.in_review}</strong>
          </span>
          <span style={pillStyle('#27a644')}>
            Resolved <strong>{statusCounts.resolved}</strong>
          </span>
        </div>

        {/* Sentry-styled panel */}
        <ErrorBoundary section="HITL Queue">
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
                {totalCount} review{totalCount !== 1 ? 's' : ''}
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
            ) : reviews.length === 0 ? (
              /* T4-03: Illustrated empty state */
              <div className="p-5 text-center py-16">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-sm font-medium mb-1" style={{ color: '#d0d6e0' }}>No reviews found</p>
                <p className="text-xs" style={{ color: '#62666d' }}>
                  {statusFilter || workspaceFilter ? 'Try adjusting your filters' : 'All documents are processed — no HITL reviews pending'}
                </p>
              </div>
            ) : (
              <div>
                {/* Table header */}
                <div
                  className="grid items-center px-5 py-2 text-xs font-medium"
                  style={{
                    color: '#62666d',
                    gridTemplateColumns: '120px 1fr 120px 160px 160px',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}
                >
                  <span>Trace ID</span>
                  <span>Workspace</span>
                  <span>Status</span>
                  <span>Reviewer</span>
                  <span>Created</span>
                </div>

                {/* Review rows */}
                {reviews.map((review) => (
                  <div
                    key={review.trace_id}
                    className="grid items-center px-5 py-3 cursor-pointer transition-colors"
                    style={{
                      gridTemplateColumns: '120px 1fr 120px 160px 160px',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                    }}
                    onClick={() => router.push(`/hitl/${review.trace_id}`)}
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
                        router.push(`/hitl/${review.trace_id}`);
                      }
                    }}
                  >
                    <span
                      className="text-xs font-mono"
                      style={{ color: '#c2ef4e' }}
                      title={review.trace_id}
                    >
                      {truncateId(review.trace_id)}
                    </span>
                    <span className="text-xs truncate" style={{ color: '#9ca3af' }}>
                      {workspaceMap.get(review.workspace_id) ?? truncateId(review.workspace_id)}
                    </span>
                    <div>
                      <StatusBadge status={review.status} size="sm" />
                    </div>
                    <span className="text-sm truncate" style={{ color: '#d0d6e0' }}>
                      {review.reviewer ?? 'Unassigned'}
                    </span>
                    <span className="text-xs" style={{ color: '#62666d' }}>
                      {formatTimestamp(review.created_at)}
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
