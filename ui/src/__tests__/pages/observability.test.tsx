/**
 * Page integration tests for Observability Dashboard.
 *
 * Extracts pure logic from observability/page.tsx and tests:
 * - Query parameter building from time range + workspace filter
 * - Metric formatting helpers (fmt, pct, ms)
 * - Progress bar ratio calculation
 *
 * Requirements: 9.1–9.10
 */
import { describe, it, expect } from 'vitest';

// --- Extracted helpers from observability/page.tsx ---

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

/** Mirrors the buildParams callback in ObservabilityPage */
function buildParams(
  timeRange: { range?: string; start?: string; end?: string },
  workspaceFilter: string
): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  if (timeRange.range) params.range = timeRange.range;
  if (timeRange.start) params.start = timeRange.start;
  if (timeRange.end) params.end = timeRange.end;
  if (workspaceFilter) params.workspace_id = workspaceFilter;
  return params;
}

/** Mirrors the ProgressBar ratio calculation */
function progressRatio(value: number, max: number): number {
  return max > 0 ? Math.min(value / max, 1) : 0;
}

// --- Tests ---

describe('Observability page logic', () => {
  describe('fmt - number formatting', () => {
    it('returns raw string for numbers < 1000', () => {
      expect(fmt(0)).toBe('0');
      expect(fmt(42)).toBe('42');
      expect(fmt(999)).toBe('999');
    });

    it('formats thousands with K suffix', () => {
      expect(fmt(1_000)).toBe('1.0K');
      expect(fmt(1_500)).toBe('1.5K');
      expect(fmt(50_000)).toBe('50.0K');
    });

    it('formats millions with M suffix', () => {
      expect(fmt(1_000_000)).toBe('1.0M');
      expect(fmt(2_500_000)).toBe('2.5M');
    });
  });

  describe('pct - percentage formatting', () => {
    it('formats 0 as 0.0%', () => {
      expect(pct(0)).toBe('0.0%');
    });

    it('formats 1 as 100.0%', () => {
      expect(pct(1)).toBe('100.0%');
    });

    it('formats 0.856 as 85.6%', () => {
      expect(pct(0.856)).toBe('85.6%');
    });

    it('formats small values', () => {
      expect(pct(0.001)).toBe('0.1%');
    });
  });

  describe('ms - latency formatting', () => {
    it('formats values < 1000 as milliseconds', () => {
      expect(ms(0)).toBe('0ms');
      expect(ms(500)).toBe('500ms');
      expect(ms(999)).toBe('999ms');
    });

    it('formats values >= 1000 as seconds', () => {
      expect(ms(1_000)).toBe('1.0s');
      expect(ms(5_500)).toBe('5.5s');
    });

    it('formats values >= 60000 as minutes', () => {
      expect(ms(60_000)).toBe('1.0m');
      expect(ms(150_000)).toBe('2.5m');
    });

    it('rounds millisecond values', () => {
      expect(ms(499.7)).toBe('500ms');
    });
  });

  describe('query parameter building (Req 9.2, 9.3)', () => {
    it('includes range preset', () => {
      const params = buildParams({ range: '7d' }, '');
      expect(params.range).toBe('7d');
      expect(params.workspace_id).toBeUndefined();
    });

    it('includes custom date range', () => {
      const params = buildParams({ start: '2024-01-01', end: '2024-01-31' }, '');
      expect(params.start).toBe('2024-01-01');
      expect(params.end).toBe('2024-01-31');
      expect(params.range).toBeUndefined();
    });

    it('includes workspace filter', () => {
      const params = buildParams({ range: '24h' }, 'ws-123');
      expect(params.range).toBe('24h');
      expect(params.workspace_id).toBe('ws-123');
    });

    it('returns empty object when no filters set', () => {
      const params = buildParams({}, '');
      expect(Object.keys(params)).toHaveLength(0);
    });

    it('includes all params when all set', () => {
      const params = buildParams({ range: '30d', start: '2024-01-01', end: '2024-01-31' }, 'ws-abc');
      expect(params.range).toBe('30d');
      expect(params.start).toBe('2024-01-01');
      expect(params.end).toBe('2024-01-31');
      expect(params.workspace_id).toBe('ws-abc');
    });
  });

  describe('progress bar ratio calculation (Req 9.7)', () => {
    it('returns 0 when max is 0', () => {
      expect(progressRatio(50, 0)).toBe(0);
    });

    it('returns correct ratio for normal values', () => {
      expect(progressRatio(50, 100)).toBe(0.5);
      expect(progressRatio(25, 100)).toBe(0.25);
    });

    it('caps at 1 when value exceeds max', () => {
      expect(progressRatio(150, 100)).toBe(1);
    });

    it('returns 0 when value is 0', () => {
      expect(progressRatio(0, 100)).toBe(0);
    });

    it('returns 1 when value equals max', () => {
      expect(progressRatio(100, 100)).toBe(1);
    });
  });
});
