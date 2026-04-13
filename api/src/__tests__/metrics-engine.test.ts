import { describe, it, expect } from 'vitest';
import {
  computeDashboardMetrics,
  computeHitlMetrics,
  computeErrorAnalysis,
  computeTimeSeries,
  resolveTimeRange,
} from '../lib/metrics-engine';
import type { Trace, HitlReview } from '../models/types';

describe('Metrics Engine Edge Cases', () => {
  // 1. Zero traces: all metrics are 0, rates are 0 (not NaN)
  it('returns all zeros and no NaN when given zero traces', () => {
    const result = computeDashboardMetrics([]);
    expect(result.total_traces).toBe(0);
    expect(result.success_count).toBe(0);
    expect(result.failure_count).toBe(0);
    expect(result.hitl_required_count).toBe(0);
    expect(result.success_rate).toBe(0);
    expect(result.failure_rate).toBe(0);
    expect(result.average_confidence).toBe(0);
    expect(result.average_latency_ms).toBe(0);
    expect(result.total_tokens).toBe(0);
    // Ensure no NaN values
    for (const value of Object.values(result)) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  // 2. All null confidence: average_confidence is 0
  it('returns average_confidence 0 when all traces have null confidence', () => {
    const traces: Trace[] = [
      { trace_id: 't1', workspace_id: 'ws1', tenant_id: 'tenant-1', status: 'completed', confidence: undefined, tokens: 10, latency: 100, prompt_version: 'v1', created_at: '2024-01-15T00:00:00Z' },
      { trace_id: 't2', workspace_id: 'ws1', tenant_id: 'tenant-1', status: 'failed', confidence: undefined, tokens: 20, latency: 200, prompt_version: 'v1', created_at: '2024-01-15T01:00:00Z' },
    ];
    const result = computeDashboardMetrics(traces);
    expect(result.average_confidence).toBe(0);
    expect(Number.isNaN(result.average_confidence)).toBe(false);
  });

  // 3. All null latency: average_latency_ms is 0
  it('returns average_latency_ms 0 when all traces have null latency', () => {
    const traces: Trace[] = [
      { trace_id: 't1', workspace_id: 'ws1', tenant_id: 'tenant-1', status: 'completed', confidence: 0.9, tokens: 10, latency: undefined, prompt_version: 'v1', created_at: '2024-01-15T00:00:00Z' },
      { trace_id: 't2', workspace_id: 'ws1', tenant_id: 'tenant-1', status: 'completed', confidence: 0.8, tokens: 20, latency: undefined, prompt_version: 'v1', created_at: '2024-01-15T01:00:00Z' },
    ];
    const result = computeDashboardMetrics(traces);
    expect(result.average_latency_ms).toBe(0);
    expect(Number.isNaN(result.average_latency_ms)).toBe(false);
  });

  // 4. No failed traces: error_analysis is empty array
  it('returns empty error_analysis when no traces are failed', () => {
    const traces: Trace[] = [
      { trace_id: 't1', workspace_id: 'ws1', tenant_id: 'tenant-1', status: 'completed', confidence: 0.9, tokens: 10, latency: 100, prompt_version: 'v1', created_at: '2024-01-15T00:00:00Z' },
      { trace_id: 't2', workspace_id: 'ws1', tenant_id: 'tenant-1', status: 'hitl_required', confidence: 0.5, tokens: 20, latency: 200, prompt_version: 'v1', created_at: '2024-01-15T01:00:00Z' },
    ];
    const result = computeErrorAnalysis(traces);
    expect(result).toEqual([]);
  });

  // 5. No HITL reviews: all hitl metrics are 0
  it('returns all zeros for HITL metrics when given no reviews', () => {
    const result = computeHitlMetrics([]);
    expect(result.total_reviews).toBe(0);
    expect(result.pending_count).toBe(0);
    expect(result.in_review_count).toBe(0);
    expect(result.resolved_count).toBe(0);
    expect(result.average_review_duration_ms).toBe(0);
    expect(result.average_correction_count).toBe(0);
  });

  // 6. No resolved reviews: average_review_duration_ms is 0
  it('returns average_review_duration_ms 0 when no reviews are resolved', () => {
    const reviews: HitlReview[] = [
      { trace_id: 't1', workspace_id: 'ws1', status: 'pending', corrections: [], created_at: '2024-01-15T00:00:00Z' },
      { trace_id: 't2', workspace_id: 'ws1', status: 'in_review', corrections: [], created_at: '2024-01-15T01:00:00Z' },
    ];
    const result = computeHitlMetrics(reviews);
    expect(result.resolved_count).toBe(0);
    expect(result.average_review_duration_ms).toBe(0);
    expect(result.average_correction_count).toBe(0);
  });

  // 7. Single-day range with daily granularity: one bucket
  it('produces exactly one bucket for a single-day range with daily granularity', () => {
    const start = new Date('2024-06-15T00:00:00Z');
    const end = new Date('2024-06-15T23:59:59Z');
    const traces: Trace[] = [
      { trace_id: 't1', workspace_id: 'ws1', tenant_id: 'tenant-1', status: 'completed', confidence: 0.9, tokens: 10, latency: 100, prompt_version: 'v1', created_at: '2024-06-15T12:00:00Z' },
    ];
    const result = computeTimeSeries(traces, 'daily', start, end);
    expect(result).toHaveLength(1);
    expect(result[0].bucket_start).toBe('2024-06-15');
    expect(result[0].metrics.total_traces).toBe(1);
  });

  // 8. Weekly granularity crossing month boundary: correct bucket assignment
  it('assigns correct weekly buckets when range crosses a month boundary', () => {
    // Jan 28 (Tue) to Feb 3 (Mon) 2024
    const start = new Date('2024-01-28T00:00:00Z');
    const end = new Date('2024-02-03T23:59:59Z');

    const traces: Trace[] = [
      { trace_id: 't1', workspace_id: 'ws1', tenant_id: 'tenant-1', status: 'completed', confidence: 0.9, tokens: 10, latency: 100, prompt_version: 'v1', created_at: '2024-01-29T12:00:00Z' },
      { trace_id: 't2', workspace_id: 'ws1', tenant_id: 'tenant-1', status: 'failed', confidence: 0.5, tokens: 20, latency: 200, prompt_version: 'v1', created_at: '2024-02-02T12:00:00Z' },
    ];

    const result = computeTimeSeries(traces, 'weekly', start, end);

    // Jan 28 is a Sunday, so its Monday-of-week is Jan 22.
    // Feb 3 is a Saturday, so its Monday-of-week is Jan 29.
    // The range should produce buckets starting from Monday of the week containing Jan 28
    // through Monday of the week containing Feb 3.
    expect(result.length).toBeGreaterThanOrEqual(1);

    // All bucket_start values should be Mondays (ISO week start)
    for (const bucket of result) {
      const d = new Date(bucket.bucket_start + 'T00:00:00Z');
      // getUTCDay() === 1 means Monday
      expect(d.getUTCDay()).toBe(1);
    }

    // Trace on Jan 29 (Mon) should be in the Jan 29 bucket
    // Trace on Feb 2 (Fri) should also be in the Jan 29 bucket (same week)
    const jan29Bucket = result.find((b) => b.bucket_start === '2024-01-29');
    if (jan29Bucket) {
      // Both traces fall in the week of Jan 29
      expect(jan29Bucket.metrics.total_traces).toBe(2);
    }

    // Verify total traces across all buckets
    const totalAcrossBuckets = result.reduce((sum, b) => sum + b.metrics.total_traces, 0);
    expect(totalAcrossBuckets).toBe(2);
  });
});
