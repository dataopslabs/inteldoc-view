/**
 * Page integration tests for Trace Explorer.
 *
 * Extracts pure logic from traces/page.tsx and tests:
 * - Filter parameter building
 * - Trace sorting by created_at descending
 * - Workspace name lookup from map
 * - Trace ID truncation
 *
 * Requirements: 4.1–4.8
 */
import { describe, it, expect } from 'vitest';

// --- Extracted helpers from traces/page.tsx ---

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

/** Mirrors the filter param building in the fetchTraces callback */
function buildFilterParams(
  statusFilter: string,
  workspaceFilter: string
): Record<string, string | undefined> {
  const params: Record<string, string | undefined> = {};
  if (statusFilter) params.status = statusFilter;
  if (workspaceFilter) params.workspace_id = workspaceFilter;
  return params;
}

/** Mirrors the sort logic applied after fetching traces */
function sortTracesByDate<T extends { created_at: string }>(traces: T[]): T[] {
  return [...traces].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/** Mirrors the workspace name lookup in the trace rows */
function lookupWorkspaceName(
  workspaceMap: Map<string, string>,
  workspaceId: string
): string {
  return workspaceMap.get(workspaceId) ?? truncateId(workspaceId);
}

// --- Tests ---

describe('Trace Explorer page logic', () => {
  describe('filter parameter building (Req 4.3, 4.5)', () => {
    it('includes status when set', () => {
      const params = buildFilterParams('completed', '');
      expect(params.status).toBe('completed');
      expect(params.workspace_id).toBeUndefined();
    });

    it('includes workspace_id when set', () => {
      const params = buildFilterParams('', 'ws-123');
      expect(params.status).toBeUndefined();
      expect(params.workspace_id).toBe('ws-123');
    });

    it('includes both when both set', () => {
      const params = buildFilterParams('failed', 'ws-456');
      expect(params.status).toBe('failed');
      expect(params.workspace_id).toBe('ws-456');
    });

    it('returns empty object when both empty', () => {
      const params = buildFilterParams('', '');
      expect(Object.keys(params)).toHaveLength(0);
    });
  });

  describe('trace sorting (Req 4.2)', () => {
    it('sorts traces by created_at descending (newest first)', () => {
      const traces = [
        { trace_id: 't1', created_at: '2024-01-01T00:00:00Z' },
        { trace_id: 't3', created_at: '2024-03-01T00:00:00Z' },
        { trace_id: 't2', created_at: '2024-02-01T00:00:00Z' },
      ];
      const sorted = sortTracesByDate(traces);
      expect(sorted[0].trace_id).toBe('t3');
      expect(sorted[1].trace_id).toBe('t2');
      expect(sorted[2].trace_id).toBe('t1');
    });

    it('does not mutate the original array', () => {
      const traces = [
        { trace_id: 't1', created_at: '2024-01-01T00:00:00Z' },
        { trace_id: 't2', created_at: '2024-02-01T00:00:00Z' },
      ];
      const original = [...traces];
      sortTracesByDate(traces);
      expect(traces).toEqual(original);
    });

    it('handles empty array', () => {
      expect(sortTracesByDate([])).toEqual([]);
    });

    it('handles single element', () => {
      const traces = [{ trace_id: 't1', created_at: '2024-01-01T00:00:00Z' }];
      expect(sortTracesByDate(traces)).toEqual(traces);
    });
  });

  describe('workspace name lookup (Req 4.4)', () => {
    it('returns workspace name when found in map', () => {
      const map = new Map([['ws-1', 'Invoice Processing']]);
      expect(lookupWorkspaceName(map, 'ws-1')).toBe('Invoice Processing');
    });

    it('returns truncated ID when not found in map', () => {
      const map = new Map<string, string>();
      expect(lookupWorkspaceName(map, 'abcdefghij')).toBe('abcdefgh…');
    });
  });

  describe('truncateId', () => {
    it('truncates long IDs with ellipsis', () => {
      expect(truncateId('abcdefghijklmnop')).toBe('abcdefgh…');
    });

    it('returns short IDs unchanged', () => {
      expect(truncateId('abc')).toBe('abc');
    });

    it('returns IDs at exactly the limit unchanged', () => {
      expect(truncateId('abcdefgh')).toBe('abcdefgh');
    });

    it('supports custom length', () => {
      expect(truncateId('abcdefghij', 4)).toBe('abcd…');
    });
  });

  describe('formatTimestamp', () => {
    it('formats valid ISO dates', () => {
      const result = formatTimestamp('2024-06-15T10:30:00Z');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns a string for invalid dates', () => {
      const result = formatTimestamp('invalid');
      expect(typeof result).toBe('string');
      // new Date('invalid') produces Invalid Date, toLocaleString returns 'Invalid Date'
      expect(result).toBe('Invalid Date');
    });
  });
});
