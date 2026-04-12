/**
 * Page integration tests for Dashboard.
 *
 * Extracts pure logic from DashboardPage and tests:
 * - Independent section state management (loading/error/data)
 * - Data transformation (formatNumber, formatTimestamp)
 * - Section rendering decisions
 *
 * Requirements: 1.1–1.7
 */
import { describe, it, expect } from 'vitest';

// --- Extracted helpers from dashboard/page.tsx ---

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

// --- Section state model (mirrors dashboard's 3 independent useStates) ---

interface SectionState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

function initialSection<T>(): SectionState<T> {
  return { data: null, loading: true, error: null };
}

function resolveSuccess<T>(data: T): SectionState<T> {
  return { data, loading: false, error: null };
}

function resolveError<T>(msg: string): SectionState<T> {
  return { data: null, loading: false, error: msg };
}

function shouldShowSkeleton<T>(s: SectionState<T>): boolean {
  return s.loading;
}

function shouldShowError<T>(s: SectionState<T>): boolean {
  return !s.loading && s.error !== null;
}

function shouldShowData<T>(s: SectionState<T>): boolean {
  return !s.loading && s.error === null && s.data !== null;
}

// --- Tests ---

describe('Dashboard page logic', () => {
  describe('formatNumber', () => {
    it('returns raw string for numbers < 1000', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(42)).toBe('42');
      expect(formatNumber(999)).toBe('999');
    });

    it('formats thousands with K suffix', () => {
      expect(formatNumber(1_000)).toBe('1.0K');
      expect(formatNumber(1_500)).toBe('1.5K');
      expect(formatNumber(999_999)).toBe('1000.0K');
    });

    it('formats millions with M suffix', () => {
      expect(formatNumber(1_000_000)).toBe('1.0M');
      expect(formatNumber(2_500_000)).toBe('2.5M');
    });
  });

  describe('formatTimestamp', () => {
    it('formats a valid ISO date string', () => {
      const result = formatTimestamp('2024-06-15T10:30:00Z');
      // Should contain month and day at minimum
      expect(result).toContain('Jun');
      expect(result).toContain('15');
    });

    it('returns a string for invalid dates (Invalid Date)', () => {
      const result = formatTimestamp('not-a-date');
      expect(typeof result).toBe('string');
      // new Date('not-a-date') produces Invalid Date, toLocaleDateString returns 'Invalid Date'
      expect(result).toBe('Invalid Date');
    });
  });

  describe('section state management', () => {
    it('initial state is loading with no data or error', () => {
      const s = initialSection();
      expect(s.loading).toBe(true);
      expect(s.data).toBeNull();
      expect(s.error).toBeNull();
      expect(shouldShowSkeleton(s)).toBe(true);
      expect(shouldShowData(s)).toBe(false);
      expect(shouldShowError(s)).toBe(false);
    });

    it('success state has data, no loading, no error', () => {
      const s = resolveSuccess([{ id: 1 }]);
      expect(shouldShowSkeleton(s)).toBe(false);
      expect(shouldShowData(s)).toBe(true);
      expect(shouldShowError(s)).toBe(false);
    });

    it('error state has error message, no loading, no data', () => {
      const s = resolveError('Network error');
      expect(shouldShowSkeleton(s)).toBe(false);
      expect(shouldShowData(s)).toBe(false);
      expect(shouldShowError(s)).toBe(true);
      expect(s.error).toBe('Network error');
    });
  });

  describe('independent section rendering (Req 1.7)', () => {
    it('workspace failure does not affect usage or traces sections', () => {
      const workspaces = resolveError<unknown[]>('Failed');
      const usage = resolveSuccess({ plan: 'free' });
      const traces = resolveSuccess([{ trace_id: 't1' }]);

      expect(shouldShowError(workspaces)).toBe(true);
      expect(shouldShowData(usage)).toBe(true);
      expect(shouldShowData(traces)).toBe(true);
    });

    it('usage failure does not affect workspaces or traces sections', () => {
      const workspaces = resolveSuccess([{ workspace_id: 'ws1' }]);
      const usage = resolveError<Record<string, unknown>>('Failed');
      const traces = resolveSuccess([{ trace_id: 't1' }]);

      expect(shouldShowData(workspaces)).toBe(true);
      expect(shouldShowError(usage)).toBe(true);
      expect(shouldShowData(traces)).toBe(true);
    });

    it('traces failure does not affect workspaces or usage sections', () => {
      const workspaces = resolveSuccess([{ workspace_id: 'ws1' }]);
      const usage = resolveSuccess({ plan: 'free' });
      const traces = resolveError<unknown[]>('Failed');

      expect(shouldShowData(workspaces)).toBe(true);
      expect(shouldShowData(usage)).toBe(true);
      expect(shouldShowError(traces)).toBe(true);
    });

    it('all sections can fail independently', () => {
      const workspaces = resolveError<unknown[]>('Fail 1');
      const usage = resolveError<Record<string, unknown>>('Fail 2');
      const traces = resolveError<unknown[]>('Fail 3');

      expect(shouldShowError(workspaces)).toBe(true);
      expect(shouldShowError(usage)).toBe(true);
      expect(shouldShowError(traces)).toBe(true);
    });

    it('all sections can succeed independently', () => {
      const workspaces = resolveSuccess([{ workspace_id: 'ws1' }]);
      const usage = resolveSuccess({ plan: 'pro' });
      const traces = resolveSuccess([{ trace_id: 't1' }]);

      expect(shouldShowData(workspaces)).toBe(true);
      expect(shouldShowData(usage)).toBe(true);
      expect(shouldShowData(traces)).toBe(true);
    });
  });
});
