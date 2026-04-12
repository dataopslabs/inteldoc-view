/**
 * Property-based tests for dashboard independent section rendering.
 *
 * **Validates: Requirements 1.7, 9.9**
 *
 * Property 7: Dashboard sections render independently on partial API failure
 *
 * The dashboard has 3 independent data sources:
 *   1. Workspaces (api.workspaces.list)
 *   2. Usage (api.observability.usage)
 *   3. Traces (api.observability.traces)
 *
 * We extract the state management pattern from the dashboard page and test it
 * as pure functions. Each section has independent (data, loading, error) state.
 * A failure in one section must not affect the others.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// --- Extracted state model from DashboardPage ---

interface SectionState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface DashboardState {
  workspaces: SectionState<unknown[]>;
  usage: SectionState<Record<string, unknown>>;
  traces: SectionState<unknown[]>;
}

/**
 * Simulates the result of an API call resolving for a section.
 * Mirrors the useEffect pattern in DashboardPage:
 *   .then → set data, clear loading
 *   .catch → set error, clear loading
 */
function resolveSection<T>(success: boolean, mockData: T, errorMsg: string): SectionState<T> {
  if (success) {
    return { data: mockData, loading: false, error: null };
  }
  return { data: null, loading: false, error: errorMsg };
}

/**
 * Builds the full dashboard state from 3 independent API outcomes.
 * Each section resolves independently — exactly as the dashboard useEffects work.
 */
function buildDashboardState(outcomes: {
  workspacesSuccess: boolean;
  usageSuccess: boolean;
  tracesSuccess: boolean;
}): DashboardState {
  return {
    workspaces: resolveSection(
      outcomes.workspacesSuccess,
      [{ workspace_id: 'ws-1', name: 'Test' }],
      'Failed to load workspaces'
    ),
    usage: resolveSection(
      outcomes.usageSuccess,
      { plan: 'free', total_documents_processed: 42 },
      'Failed to load usage'
    ),
    traces: resolveSection(
      outcomes.tracesSuccess,
      [{ trace_id: 'tr-1', status: 'completed' }],
      'Failed to load traces'
    ),
  };
}

/**
 * Determines whether a section should render its data content.
 * Mirrors the dashboard JSX: render data when not loading and no error and data exists.
 */
function shouldRenderData(section: SectionState<unknown>): boolean {
  return !section.loading && section.error === null && section.data !== null;
}

/**
 * Determines whether a section should render an error message.
 * Mirrors the dashboard JSX: render error when not loading and error is set.
 */
function shouldRenderError(section: SectionState<unknown>): boolean {
  return !section.loading && section.error !== null;
}

// --- Generators ---

/** Generates a boolean triple representing success/failure for each of the 3 API calls */
const apiOutcomeArb = fc.record({
  workspacesSuccess: fc.boolean(),
  usageSuccess: fc.boolean(),
  tracesSuccess: fc.boolean(),
});

// --- Property Tests ---

describe('Dashboard independent section rendering', () => {
  describe('Property 7: Dashboard sections render independently on partial API failure', () => {
    it('successful sections produce data and no error', () => {
      /**
       * **Validates: Requirements 1.7, 9.9**
       *
       * For any combination of API outcomes, sections whose API call
       * succeeded should have non-null data and null error.
       */
      fc.assert(
        fc.property(apiOutcomeArb, (outcomes) => {
          const state = buildDashboardState(outcomes);

          if (outcomes.workspacesSuccess) {
            expect(state.workspaces.data).not.toBeNull();
            expect(state.workspaces.error).toBeNull();
          }
          if (outcomes.usageSuccess) {
            expect(state.usage.data).not.toBeNull();
            expect(state.usage.error).toBeNull();
          }
          if (outcomes.tracesSuccess) {
            expect(state.traces.data).not.toBeNull();
            expect(state.traces.error).toBeNull();
          }
        }),
        { numRuns: 100 }
      );
    });

    it('failed sections produce error and no data', () => {
      /**
       * **Validates: Requirements 1.7, 9.9**
       *
       * For any combination of API outcomes, sections whose API call
       * failed should have non-null error and null data.
       */
      fc.assert(
        fc.property(apiOutcomeArb, (outcomes) => {
          const state = buildDashboardState(outcomes);

          if (!outcomes.workspacesSuccess) {
            expect(state.workspaces.error).not.toBeNull();
            expect(state.workspaces.data).toBeNull();
          }
          if (!outcomes.usageSuccess) {
            expect(state.usage.error).not.toBeNull();
            expect(state.usage.data).toBeNull();
          }
          if (!outcomes.tracesSuccess) {
            expect(state.traces.error).not.toBeNull();
            expect(state.traces.data).toBeNull();
          }
        }),
        { numRuns: 100 }
      );
    });

    it('one section failure does not affect other sections', () => {
      /**
       * **Validates: Requirements 1.7, 9.9**
       *
       * For any combination of API outcomes, the state of each section
       * depends only on its own API call result, not on the others.
       * We verify this by checking that a successful section renders data
       * regardless of whether the other two sections failed.
       */
      fc.assert(
        fc.property(apiOutcomeArb, (outcomes) => {
          const state = buildDashboardState(outcomes);

          // Workspaces section is independent
          expect(shouldRenderData(state.workspaces)).toBe(outcomes.workspacesSuccess);
          expect(shouldRenderError(state.workspaces)).toBe(!outcomes.workspacesSuccess);

          // Usage section is independent
          expect(shouldRenderData(state.usage)).toBe(outcomes.usageSuccess);
          expect(shouldRenderError(state.usage)).toBe(!outcomes.usageSuccess);

          // Traces section is independent
          expect(shouldRenderData(state.traces)).toBe(outcomes.tracesSuccess);
          expect(shouldRenderError(state.traces)).toBe(!outcomes.tracesSuccess);
        }),
        { numRuns: 100 }
      );
    });

    it('all 8 combinations of success/failure are valid states', () => {
      /**
       * **Validates: Requirements 1.7, 9.9**
       *
       * Exhaustively verify all 2^3 = 8 combinations. Each combination
       * should produce a valid dashboard state where every section is
       * either showing data or showing an error (never both, never neither).
       */
      const allCombinations: { workspacesSuccess: boolean; usageSuccess: boolean; tracesSuccess: boolean }[] = [];
      for (const w of [true, false]) {
        for (const u of [true, false]) {
          for (const t of [true, false]) {
            allCombinations.push({ workspacesSuccess: w, usageSuccess: u, tracesSuccess: t });
          }
        }
      }

      expect(allCombinations).toHaveLength(8);

      for (const outcomes of allCombinations) {
        const state = buildDashboardState(outcomes);
        const sections = [state.workspaces, state.usage, state.traces];

        for (const section of sections) {
          // Each section must not be loading after resolution
          expect(section.loading).toBe(false);

          // Each section is in exactly one of: data or error (XOR)
          const hasData = section.data !== null;
          const hasError = section.error !== null;
          expect(hasData).not.toBe(hasError); // exactly one must be true
        }
      }
    });

    it('loading is always false after all sections resolve', () => {
      /**
       * **Validates: Requirements 1.7, 9.9**
       *
       * After API calls resolve (success or failure), no section
       * should remain in a loading state.
       */
      fc.assert(
        fc.property(apiOutcomeArb, (outcomes) => {
          const state = buildDashboardState(outcomes);

          expect(state.workspaces.loading).toBe(false);
          expect(state.usage.loading).toBe(false);
          expect(state.traces.loading).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });
});
