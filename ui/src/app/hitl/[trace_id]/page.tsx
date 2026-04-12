'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import { StatusBadge } from '@/components/StatusBadge';
import { ConfidenceIndicator } from '@/components/ConfidenceIndicator';
import { Skeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useToast } from '@/components/ToastProvider';
import { useAuth } from '@/components/AuthProvider';
import { api, HitlReview, Trace, Correction } from '@/lib/api';

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export default function HitlReviewDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { showToast } = useToast();
  const traceId = params.trace_id as string;

  const [review, setReview] = useState<HitlReview | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Track corrections: field_name → { original_value, corrected_value }
  const [corrections, setCorrections] = useState<Map<string, { original_value: unknown; corrected_value: string }>>(
    new Map()
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.hitl.get(traceId);
      setReview(res.review);
      setTrace(res.trace);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch review');
    } finally {
      setLoading(false);
    }
  }, [traceId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAssign = async () => {
    if (!user?.email) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await api.hitl.assign(traceId, user.email);
      await fetchData();
      showToast('Review assigned to you', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to assign review';
      setActionError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitCorrections = async () => {
    if (corrections.size === 0) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const correctionArray: Correction[] = Array.from(corrections.entries()).map(
        ([field_name, { original_value, corrected_value }]) => ({
          field_name,
          original_value,
          corrected_value,
        })
      );
      await api.hitl.submitCorrections(traceId, correctionArray);
      setCorrections(new Map());
      await fetchData();
      showToast(`${correctionArray.length} correction${correctionArray.length !== 1 ? 's' : ''} submitted`, 'success');
    } catch (err) {
      // Preserve unsaved corrections on error
      const msg = err instanceof Error ? err.message : 'Failed to submit corrections';
      setActionError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolve = async () => {
    setSubmitting(true);
    setActionError(null);
    try {
      await api.hitl.resolve(traceId);
      await fetchData();
      showToast('Review resolved successfully', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resolve review';
      setActionError(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFieldChange = (fieldName: string, originalValue: unknown, newValue: string) => {
    setCorrections((prev) => {
      const next = new Map(prev);
      const originalStr = String(originalValue ?? '');
      if (newValue === originalStr) {
        next.delete(fieldName);
      } else {
        next.set(fieldName, { original_value: originalValue, corrected_value: newValue });
      }
      return next;
    });
  };

  const isInReview = review?.status === 'in_review';
  const isPending = review?.status === 'pending';
  const isResolved = review?.status === 'resolved';

  const panelStyle: React.CSSProperties = {
    backgroundColor: '#1a1025',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '8px',
  };

  const buttonBase: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    border: 'none',
    transition: 'opacity 0.15s',
  };

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="Review Detail" />
      <div className="flex-1 p-6 max-w-5xl mx-auto w-full space-y-6">
        <ErrorBoundary section="Review Detail">
        {/* Back link */}
        <button
          onClick={() => router.push('/hitl')}
          className="text-xs hover:underline"
          style={{ color: '#c2ef4e', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          ← Back to Review Queue
        </button>

        {loading ? (
          <div className="space-y-4">
            <Skeleton variant="card" count={1} />
            <Skeleton variant="row" count={6} />
          </div>
        ) : error ? (
          <div className="p-6 text-center" style={panelStyle}>
            <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
          </div>
        ) : review && trace ? (
          <>
            {/* Review header */}
            <div style={panelStyle} className="p-5">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold" style={{ color: '#e5e7eb' }}>
                      Review
                    </h2>
                    <StatusBadge status={review.status} size="md" />
                  </div>
                  <div className="flex items-center gap-4 text-xs" style={{ color: '#9ca3af' }}>
                    <span>
                      Trace:{' '}
                      <span className="font-mono" style={{ color: '#c2ef4e' }}>
                        {traceId.slice(0, 12)}…
                      </span>
                    </span>
                    {trace.filename && <span>File: {trace.filename}</span>}
                  </div>
                  <div className="flex items-center gap-4 text-xs" style={{ color: '#62666d' }}>
                    <span>Reviewer: {review.reviewer ?? 'Unassigned'}</span>
                    <span>Created: {formatTimestamp(review.created_at)}</span>
                    {review.assigned_at && <span>Assigned: {formatTimestamp(review.assigned_at)}</span>}
                    {review.resolved_at && <span>Resolved: {formatTimestamp(review.resolved_at)}</span>}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {isPending && (
                    <button
                      onClick={handleAssign}
                      disabled={submitting}
                      style={{
                        ...buttonBase,
                        backgroundColor: '#7170ff',
                        color: '#fff',
                        opacity: submitting ? 0.6 : 1,
                      }}
                    >
                      {submitting ? 'Assigning…' : 'Assign to me'}
                    </button>
                  )}
                  {isInReview && (
                    <>
                      <button
                        onClick={handleSubmitCorrections}
                        disabled={submitting || corrections.size === 0}
                        style={{
                          ...buttonBase,
                          backgroundColor: '#c2ef4e',
                          color: '#1a1025',
                          opacity: submitting || corrections.size === 0 ? 0.5 : 1,
                        }}
                      >
                        {submitting ? 'Submitting…' : `Submit corrections (${corrections.size})`}
                      </button>
                      <button
                        onClick={handleResolve}
                        disabled={submitting}
                        style={{
                          ...buttonBase,
                          backgroundColor: '#27a644',
                          color: '#fff',
                          opacity: submitting ? 0.6 : 1,
                        }}
                      >
                        {submitting ? 'Resolving…' : 'Resolve'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Inline action error */}
              {actionError && (
                <div
                  className="mt-3 px-3 py-2 rounded text-xs"
                  style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                >
                  {actionError}
                </div>
              )}

              {/* Resolution metrics */}
              {isResolved && (
                <div
                  className="mt-4 flex items-center gap-6 px-4 py-3 rounded"
                  style={{ backgroundColor: 'rgba(39,166,68,0.08)', border: '1px solid rgba(39,166,68,0.2)' }}
                >
                  <div>
                    <span className="text-xs block" style={{ color: '#62666d' }}>Review Duration</span>
                    <span className="text-sm font-medium" style={{ color: '#27a644' }}>
                      {review.review_duration_ms != null ? formatDuration(review.review_duration_ms) : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs block" style={{ color: '#62666d' }}>Corrections Made</span>
                    <span className="text-sm font-medium" style={{ color: '#27a644' }}>
                      {review.correction_count ?? review.corrections.length}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Fields table */}
            <div style={panelStyle} className="overflow-hidden">
              <div
                className="px-5 py-3 text-xs font-medium"
                style={{ color: '#62666d', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
              >
                Extracted Fields
              </div>

              {trace.fields && trace.fields.length > 0 ? (
                <>
                  {/* Table header */}
                  <div
                    className="grid items-center px-5 py-2 text-xs font-medium"
                    style={{
                      color: '#62666d',
                      gridTemplateColumns: '160px 1fr 120px 1fr',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                    }}
                  >
                    <span>Field</span>
                    <span>Current Value</span>
                    <span>Confidence</span>
                    <span>{isInReview ? 'Corrected Value' : ''}</span>
                  </div>

                  {/* Field rows */}
                  {trace.fields.map((field) => {
                    const currentValue = field.final_value ?? field.llm_value ?? field.docling_value;
                    const currentStr = String(currentValue ?? '');
                    const correction = corrections.get(field.field);
                    const inputValue = correction ? correction.corrected_value : currentStr;

                    return (
                      <div
                        key={field.field}
                        className="grid items-center px-5 py-3"
                        style={{
                          gridTemplateColumns: '160px 1fr 120px 1fr',
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                        }}
                      >
                        <span className="text-xs font-medium" style={{ color: '#d0d6e0' }}>
                          {field.field}
                        </span>
                        <span
                          className="text-xs font-mono truncate pr-3"
                          style={{ color: '#9ca3af' }}
                          title={currentStr}
                        >
                          {currentStr || '—'}
                        </span>
                        <div className="pr-3">
                          <ConfidenceIndicator value={field.confidence} variant="sentry" showLabel />
                        </div>
                        <div>
                          {isInReview ? (
                            <input
                              type="text"
                              value={inputValue}
                              onChange={(e) =>
                                handleFieldChange(field.field, currentValue, e.target.value)
                              }
                              className="w-full text-xs px-2 py-1.5 rounded"
                              style={{
                                backgroundColor: '#2a1f3d',
                                color: '#e5e7eb',
                                border: correction
                                  ? '1px solid #c2ef4e'
                                  : '1px solid rgba(255,255,255,0.1)',
                                outline: 'none',
                              }}
                              aria-label={`Corrected value for ${field.field}`}
                            />
                          ) : isResolved ? (
                            // Show submitted corrections for resolved reviews
                            (() => {
                              const submitted = review.corrections.find(
                                (c) => c.field_name === field.field
                              );
                              return submitted ? (
                                <span className="text-xs font-mono" style={{ color: '#c2ef4e' }}>
                                  {String(submitted.corrected_value)}
                                </span>
                              ) : null;
                            })()
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                <div className="p-5 text-center">
                  <p className="text-xs" style={{ color: '#62666d' }}>
                    No extracted fields available
                  </p>
                </div>
              )}
            </div>

            {/* Previous corrections */}
            {review.corrections.length > 0 && !isResolved && (
              <div style={panelStyle} className="overflow-hidden">
                <div
                  className="px-5 py-3 text-xs font-medium"
                  style={{ color: '#62666d', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                >
                  Submitted Corrections ({review.corrections.length})
                </div>
                {review.corrections.map((c, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 px-5 py-2 text-xs"
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                  >
                    <span className="font-medium" style={{ color: '#d0d6e0', minWidth: '140px' }}>
                      {c.field_name}
                    </span>
                    <span style={{ color: '#62666d' }}>{String(c.original_value)}</span>
                    <span style={{ color: '#62666d' }}>→</span>
                    <span style={{ color: '#c2ef4e' }}>{String(c.corrected_value)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
        </ErrorBoundary>
      </div>
    </div>
  );
}
