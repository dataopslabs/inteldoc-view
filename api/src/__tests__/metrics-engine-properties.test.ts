import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  computeDashboardMetrics,
  computeHitlMetrics,
  computeAgentMetrics,
  computeErrorAnalysis,
  computeTimeSeries,
  groupByWorkspace,
  computeUsageSummary,
  resolveTimeRange,
  filterByTimeRange,
} from '../lib/metrics-engine';
import type { Trace, HitlReview } from '../models/types';

/**
 * Metrics Engine — Property-Based Tests
 *
 * Tests for Properties 1–9, 12, 13 from the observability-tracing design.
 * Uses fast-check with 200 runs per property.
 */

// --- Date helpers ---

const JAN_1_2024 = new Date('2024-01-01T00:00:00.000Z').getTime();
const JUN_30_2024 = new Date('2024-06-30T23:59:59.999Z').getTime();
const JUL_1_2024 = new Date('2024-07-01T00:00:00.000Z').getTime();
const DEC_31_2024 = new Date('2024-12-31T23:59:59.999Z').getTime();
const MAR_1_2024 = new Date('2024-03-01T00:00:00.000Z').getTime();

// Safe date arbitrary using integer timestamps to avoid Date(NaN)
const dateIn2024Arb = fc.integer({ min: JAN_1_2024, max: DEC_31_2024 }).map(ts => new Date(ts));
const isoIn2024Arb = fc.integer({ min: JAN_1_2024, max: DEC_31_2024 }).map(ts => new Date(ts).toISOString());
const dateFirstHalfArb = fc.integer({ min: JAN_1_2024, max: JUN_30_2024 }).map(ts => new Date(ts));
const dateSecondHalfArb = fc.integer({ min: JUL_1_2024, max: DEC_31_2024 }).map(ts => new Date(ts));
const dateEarly2024Arb = fc.integer({ min: JAN_1_2024, max: MAR_1_2024 }).map(ts => new Date(ts));

// --- Arbitraries ---

const traceStatusArb = fc.constantFrom('completed', 'failed', 'hitl_required') as fc.Arbitrary<Trace['status']>;

const traceArb: fc.Arbitrary<Trace> = fc.record({
  trace_id: fc.uuid(),
  workspace_id: fc.constantFrom('ws-1', 'ws-2', 'ws-3'),
  status: traceStatusArb,
  confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
  latency: fc.option(fc.double({ min: 0, max: 60000, noNaN: true }), { nil: undefined }),
  agent_steps: fc.constant(undefined),
  error: fc.option(fc.constantFrom('Error A', 'Error B', 'Error C', 'Timeout'), { nil: undefined }),
  prompt_version: fc.constant('v1'),
  created_at: isoIn2024Arb,
});

const agentStepArb = fc.record({
  agent_name: fc.constantFrom('extraction', 'classification', 'summarization'),
  status: fc.constantFrom('completed', 'failed'),
  latency: fc.option(fc.double({ min: 0, max: 10000, noNaN: true }), { nil: undefined }),
  input_tokens: fc.option(fc.integer({ min: 0, max: 50000 }), { nil: undefined }),
  output_tokens: fc.option(fc.integer({ min: 0, max: 50000 }), { nil: undefined }),
  model_id: fc.constantFrom('model-a', 'model-b'),
});

const traceWithAgentStepsArb: fc.Arbitrary<Trace> = fc.record({
  trace_id: fc.uuid(),
  workspace_id: fc.constantFrom('ws-1', 'ws-2', 'ws-3'),
  status: traceStatusArb,
  confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  tokens: fc.option(fc.integer({ min: 0, max: 100000 }), { nil: undefined }),
  latency: fc.option(fc.double({ min: 0, max: 60000, noNaN: true }), { nil: undefined }),
  agent_steps: fc.array(agentStepArb, { minLength: 1, maxLength: 5 }),
  error: fc.option(fc.constantFrom('Error A', 'Error B', 'Error C', 'Timeout'), { nil: undefined }),
  prompt_version: fc.constant('v1'),
  created_at: isoIn2024Arb,
});

const reviewStatusArb = fc.constantFrom('pending', 'in_review', 'resolved') as fc.Arbitrary<HitlReview['status']>;

const hitlReviewArb: fc.Arbitrary<HitlReview> = fc.record({
  trace_id: fc.uuid(),
  workspace_id: fc.constantFrom('ws-1', 'ws-2', 'ws-3'),
  status: reviewStatusArb,
  reviewer: fc.option(fc.string({ minLength: 1, maxLength: 10 }), { nil: undefined }),
  corrections: fc.constant([]),
  assigned_at: fc.option(isoIn2024Arb, { nil: undefined }),
  resolved_at: fc.option(isoIn2024Arb, { nil: undefined }),
  review_duration_ms: fc.option(fc.double({ min: 0, max: 600000, noNaN: true }), { nil: undefined }),
  correction_count: fc.option(fc.integer({ min: 0, max: 50 }), { nil: undefined }),
  created_at: isoIn2024Arb,
});

const failedTraceArb: fc.Arbitrary<Trace> = fc.record({
  trace_id: fc.uuid(),
  workspace_id: fc.constantFrom('ws-1', 'ws-2', 'ws-3'),
  status: fc.constant('failed') as fc.Arbitrary<Trace['status']>,
  confidence: fc.constant(undefined),
  tokens: fc.constant(undefined),
  latency: fc.constant(undefined),
  agent_steps: fc.constant(undefined),
  error: fc.constantFrom('Error A', 'Error B', 'Error C', 'Timeout', 'Network Error',
    'Parse Error', 'Auth Error', 'Rate Limit', 'Disk Full', 'OOM', 'Crash', 'Unknown'),
  prompt_version: fc.constant('v1'),
  created_at: isoIn2024Arb,
});

// --- Property Tests ---

describe('Metrics Engine — Property-Based Tests', () => {
  /**
   * Property 1: Success rate + failure rate + hitl_required rate = 1.0
   *
   * For non-empty trace lists with only 'completed', 'failed', 'hitl_required' statuses,
   * verify success_rate + failure_rate + hitl_required_count / total_traces ≈ 1.0.
   * For empty lists, all rates should be 0.
   *
   * **Validates: Requirements 1.1, 1.6**
   */
  it('Property 1: rate sum equals 1.0 for non-empty traces', () => {
    fc.assert(
      fc.property(
        fc.array(traceArb, { minLength: 1, maxLength: 100 }),
        (traces) => {
          const metrics = computeDashboardMetrics(traces);
          const rateSum =
            metrics.success_rate +
            metrics.failure_rate +
            metrics.hitl_required_count / metrics.total_traces;
          expect(Math.abs(rateSum - 1.0)).toBeLessThan(1e-10);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('Property 1: all rates are 0 for empty traces', () => {
    const metrics = computeDashboardMetrics([]);
    expect(metrics.success_rate).toBe(0);
    expect(metrics.failure_rate).toBe(0);
    expect(metrics.hitl_required_count).toBe(0);
    expect(metrics.total_traces).toBe(0);
  });


  /**
   * Property 2: Average confidence is arithmetic mean of non-null values
   *
   * Generate traces with nullable confidence. Compute manual mean of non-null
   * confidence values. Verify average_confidence matches within 1e-10.
   * When all null, verify 0.
   *
   * **Validates: Requirements 1.7**
   */
  it('Property 2: average confidence is arithmetic mean of non-null values', () => {
    fc.assert(
      fc.property(
        fc.array(traceArb, { minLength: 1, maxLength: 100 }),
        (traces) => {
          const metrics = computeDashboardMetrics(traces);
          const nonNull = traces.filter(t => t.confidence != null).map(t => t.confidence!);
          if (nonNull.length === 0) {
            expect(metrics.average_confidence).toBe(0);
          } else {
            const expectedMean = nonNull.reduce((a, b) => a + b, 0) / nonNull.length;
            expect(Math.abs(metrics.average_confidence - expectedMean)).toBeLessThan(1e-10);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Property 3: Average latency is arithmetic mean of non-null values
   *
   * Same as Property 2 but for latency.
   *
   * **Validates: Requirements 1.8**
   */
  it('Property 3: average latency is arithmetic mean of non-null values', () => {
    fc.assert(
      fc.property(
        fc.array(traceArb, { minLength: 1, maxLength: 100 }),
        (traces) => {
          const metrics = computeDashboardMetrics(traces);
          const nonNull = traces.filter(t => t.latency != null).map(t => t.latency!);
          if (nonNull.length === 0) {
            expect(metrics.average_latency_ms).toBe(0);
          } else {
            const expectedMean = nonNull.reduce((a, b) => a + b, 0) / nonNull.length;
            expect(Math.abs(metrics.average_latency_ms - expectedMean)).toBeLessThan(1e-10);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Property 4: Time-range filtering includes only records within bounds
   *
   * Generate records with timestamps and a time range. Verify filtered result
   * contains exactly records where start <= created_at <= end.
   *
   * **Validates: Requirements 2.1, 2.2**
   */
  it('Property 4: time-range filtering includes only records within bounds', () => {
    fc.assert(
      fc.property(
        fc.array(traceArb, { minLength: 0, maxLength: 50 }),
        dateFirstHalfArb,
        dateSecondHalfArb,
        (traces, startDate, endDate) => {
          const filtered = filterByTimeRange(traces, startDate, endDate);

          // Every filtered record must be within bounds
          for (const t of filtered) {
            const ts = new Date(t.created_at).getTime();
            expect(ts).toBeGreaterThanOrEqual(startDate.getTime());
            expect(ts).toBeLessThanOrEqual(endDate.getTime());
          }

          // Every record within bounds must be in the filtered result
          const expected = traces.filter(t => {
            const ts = new Date(t.created_at).getTime();
            return ts >= startDate.getTime() && ts <= endDate.getTime();
          });
          expect(filtered.length).toBe(expected.length);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Property 5: Custom start/end takes precedence over range
   *
   * Generate params with both range and start/end. Verify resolveTimeRange
   * returns the start/end values, not the range preset.
   *
   * **Validates: Requirements 2.3**
   */
  it('Property 5: custom start/end takes precedence over range', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('24h', '7d', '30d'),
        dateFirstHalfArb,
        dateSecondHalfArb,
        (range, start, end) => {
          const startIso = start.toISOString();
          const endIso = end.toISOString();

          const result = resolveTimeRange({ range, start: startIso, end: endIso });

          // start/end should take precedence — result should match the custom values
          expect(result.startDate.getTime()).toBe(new Date(startIso).getTime());
          expect(result.endDate.getTime()).toBe(new Date(endIso).getTime());
        }
      ),
      { numRuns: 200 }
    );
  });


  /**
   * Property 6: Total tokens equals sum of individual trace tokens
   *
   * Generate traces with nullable tokens. Verify total_tokens equals sum
   * treating null/undefined as 0.
   *
   * **Validates: Requirements 1.1, 8.3**
   */
  it('Property 6: total tokens equals sum of individual trace tokens', () => {
    fc.assert(
      fc.property(
        fc.array(traceArb, { minLength: 0, maxLength: 100 }),
        (traces) => {
          const metrics = computeDashboardMetrics(traces);
          const expectedSum = traces.reduce((sum, t) => sum + (t.tokens ?? 0), 0);
          expect(metrics.total_tokens).toBe(expectedSum);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Property 7: Per-workspace metrics sum to tenant-wide metrics
   *
   * Generate traces with workspace_ids. Verify sum of total_traces across
   * workspace groups equals tenant-wide total_traces. Verify sum of total_tokens
   * across workspace groups equals tenant-wide total_tokens.
   *
   * **Validates: Requirements 4.1, 4.3**
   */
  it('Property 7: per-workspace metrics sum to tenant-wide metrics', () => {
    fc.assert(
      fc.property(
        fc.array(traceArb, { minLength: 1, maxLength: 100 }),
        (traces) => {
          const tenantMetrics = computeDashboardMetrics(traces);
          const workspaceNames = new Map<string, string>([
            ['ws-1', 'Workspace 1'],
            ['ws-2', 'Workspace 2'],
            ['ws-3', 'Workspace 3'],
          ]);
          const groups = groupByWorkspace(traces, workspaceNames);

          const totalTracesSum = groups.reduce((s, g) => s + g.metrics.total_traces, 0);
          const totalTokensSum = groups.reduce((s, g) => s + g.metrics.total_tokens, 0);

          expect(totalTracesSum).toBe(tenantMetrics.total_traces);
          expect(totalTokensSum).toBe(tenantMetrics.total_tokens);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Property 8: Agent step metrics consistency
   *
   * Generate traces with agent_steps arrays. Verify sum of total_executions
   * across agent groups equals total agent_step entries. Verify sum of
   * total_input_tokens + total_output_tokens across agents equals sum of
   * all step tokens.
   *
   * **Validates: Requirements 5.1, 5.2**
   */
  it('Property 8: agent step metrics are consistent with trace-level totals', () => {
    fc.assert(
      fc.property(
        fc.array(traceWithAgentStepsArb, { minLength: 1, maxLength: 30 }),
        (traces) => {
          const agentMetrics = computeAgentMetrics(traces);

          // Total executions across all agents should equal total agent_step entries
          const totalSteps = traces.reduce(
            (sum, t) => sum + (t.agent_steps ? t.agent_steps.length : 0),
            0
          );
          const totalExecSum = agentMetrics.reduce((s, a) => s + a.total_executions, 0);
          expect(totalExecSum).toBe(totalSteps);

          // Sum of input + output tokens across agents should equal sum of all step tokens
          const allSteps = traces.flatMap(t => (t.agent_steps ?? []) as Array<{
            input_tokens?: number;
            output_tokens?: number;
          }>);
          const expectedInputTokens = allSteps.reduce((s, step) => s + (step.input_tokens ?? 0), 0);
          const expectedOutputTokens = allSteps.reduce((s, step) => s + (step.output_tokens ?? 0), 0);

          const actualInputTokens = agentMetrics.reduce((s, a) => s + a.total_input_tokens, 0);
          const actualOutputTokens = agentMetrics.reduce((s, a) => s + a.total_output_tokens, 0);

          expect(actualInputTokens).toBe(expectedInputTokens);
          expect(actualOutputTokens).toBe(expectedOutputTokens);
        }
      ),
      { numRuns: 200 }
    );
  });


  /**
   * Property 9: Error analysis sorted and capped
   *
   * Generate failed traces with error messages. Verify result is sorted by
   * count desc. Verify at most `limit` entries. Verify count sum <= total
   * failed traces.
   *
   * **Validates: Requirements 7.1, 7.2, 7.3**
   */
  it('Property 9: error analysis is sorted by count desc and capped at limit', () => {
    fc.assert(
      fc.property(
        fc.array(failedTraceArb, { minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 20 }),
        (traces, limit) => {
          const result = computeErrorAnalysis(traces, limit);

          // Sorted by count descending
          for (let i = 1; i < result.length; i++) {
            expect(result[i].count).toBeLessThanOrEqual(result[i - 1].count);
          }

          // At most `limit` entries
          expect(result.length).toBeLessThanOrEqual(limit);

          // Count sum <= total failed traces
          const countSum = result.reduce((s, g) => s + g.count, 0);
          const totalFailed = traces.filter(t => t.status === 'failed').length;
          expect(countSum).toBeLessThanOrEqual(totalFailed);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Property 12: Time-series buckets cover full range
   *
   * Generate date ranges and granularity (daily/weekly). Verify contiguous
   * bucket sequence from start to end with no gaps. Verify empty buckets
   * have zero-value metrics.
   *
   * **Validates: Requirements 9.1, 9.2, 9.4**
   */
  it('Property 12: time-series buckets cover full range with no gaps', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('daily' as const, 'weekly' as const),
        dateEarly2024Arb,
        fc.integer({ min: 1, max: 60 }),
        (granularity, startDate, dayOffset) => {
          const endDate = new Date(startDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
          const buckets = computeTimeSeries([], granularity, startDate, endDate);

          // Should have at least 1 bucket
          expect(buckets.length).toBeGreaterThanOrEqual(1);

          // All empty buckets should have zero-value metrics
          for (const bucket of buckets) {
            expect(bucket.metrics.total_traces).toBe(0);
            expect(bucket.metrics.success_count).toBe(0);
            expect(bucket.metrics.failure_count).toBe(0);
            expect(bucket.metrics.total_tokens).toBe(0);
          }

          // Buckets should be contiguous (each bucket_start is after the previous)
          for (let i = 1; i < buckets.length; i++) {
            const prev = new Date(buckets[i - 1].bucket_start).getTime();
            const curr = new Date(buckets[i].bucket_start).getTime();
            expect(curr).toBeGreaterThan(prev);

            if (granularity === 'daily') {
              const diffDays = (curr - prev) / (24 * 60 * 60 * 1000);
              expect(diffDays).toBe(1);
            } else {
              const diffDays = (curr - prev) / (24 * 60 * 60 * 1000);
              expect(diffDays).toBe(7);
            }
          }

          // First bucket should be <= startDate (UTC day)
          const firstBucket = new Date(buckets[0].bucket_start).getTime();
          const startDay = new Date(
            Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate())
          ).getTime();
          expect(firstBucket).toBeLessThanOrEqual(startDay);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Property 13: HITL averages from resolved reviews only
   *
   * Generate review records with mixed statuses. Verify average_review_duration_ms
   * computed only from resolved reviews with non-null duration. Verify
   * average_correction_count computed only from resolved reviews with non-null
   * correction_count.
   *
   * **Validates: Requirements 6.2, 6.3**
   */
  it('Property 13: HITL averages computed only from resolved reviews', () => {
    fc.assert(
      fc.property(
        fc.array(hitlReviewArb, { minLength: 1, maxLength: 50 }),
        (reviews) => {
          const metrics = computeHitlMetrics(reviews);

          // Compute expected average_review_duration_ms from resolved reviews with non-null duration
          const resolvedWithDuration = reviews.filter(
            r => r.status === 'resolved' && r.review_duration_ms != null
          );
          if (resolvedWithDuration.length === 0) {
            expect(metrics.average_review_duration_ms).toBe(0);
          } else {
            const expectedDuration =
              resolvedWithDuration.reduce((s, r) => s + r.review_duration_ms!, 0) /
              resolvedWithDuration.length;
            expect(Math.abs(metrics.average_review_duration_ms - expectedDuration)).toBeLessThan(1e-10);
          }

          // Compute expected average_correction_count from resolved reviews with non-null correction_count
          const resolvedWithCorrections = reviews.filter(
            r => r.status === 'resolved' && r.correction_count != null
          );
          if (resolvedWithCorrections.length === 0) {
            expect(metrics.average_correction_count).toBe(0);
          } else {
            const expectedCorrections =
              resolvedWithCorrections.reduce((s, r) => s + r.correction_count!, 0) /
              resolvedWithCorrections.length;
            expect(Math.abs(metrics.average_correction_count - expectedCorrections)).toBeLessThan(1e-10);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
