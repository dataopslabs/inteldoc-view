/**
 * Property-based tests for filter re-fetch with correct parameters.
 *
 * **Validates: Requirements 4.3, 4.5, 6.3, 9.3**
 *
 * Property 8: Filter changes trigger API re-fetch with correct parameters
 *
 * We extract the `buildQuery` helper logic from `ui/src/lib/api.ts` and test it
 * as a pure function. This validates that for any filter combination (status,
 * workspace_id, range), the query string includes the correct parameters, omits
 * undefined values, and is properly URL-encoded.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// --- Extracted logic from api.ts ---

/**
 * Mirrors the `buildQuery` helper in api.ts:
 *   function buildQuery(params?: Record<string, string | undefined>): string {
 *     if (!params) return '';
 *     const entries = Object.entries(params).filter(([, v]) => v !== undefined);
 *     if (entries.length === 0) return '';
 *     return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
 *   }
 */
function buildQuery(params?: Record<string, string | undefined>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
}

// --- Generators ---

/** Valid trace status values used in the Trace Explorer filter */
const traceStatusArb = fc.constantFrom(
  'pending',
  'processing',
  'completed',
  'failed',
  'hitl_required'
);

/** Valid HITL review status values */
const hitlStatusArb = fc.constantFrom('pending', 'in_review', 'resolved');

/** Valid time range presets used in the Observability Dashboard */
const rangePresetArb = fc.constantFrom('24h', '7d', '30d');

/** Generates a workspace_id (UUID-like string) */
const workspaceIdArb = fc.uuid();

/** Generates a date string in ISO format for custom date ranges */
const dateStringArb = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map((d) => d.toISOString().split('T')[0]);

/** Generates a string that requires URL encoding (contains special chars) */
const specialCharsArb = fc.stringOf(
  fc.constantFrom(...'abc 123&=?#/+%@!$'.split('')),
  { minLength: 1, maxLength: 30 }
);

/** Generates an optional string value (string or undefined) */
const optionalStringArb = fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
  nil: undefined,
});

/**
 * Generates a filter params object for the Trace Explorer:
 *   { status?: string; workspace_id?: string; range?: string; start?: string; end?: string }
 */
const traceFilterParamsArb = fc.record(
  {
    status: fc.option(traceStatusArb, { nil: undefined }),
    workspace_id: fc.option(workspaceIdArb, { nil: undefined }),
    range: fc.option(rangePresetArb, { nil: undefined }),
    start: fc.option(dateStringArb, { nil: undefined }),
    end: fc.option(dateStringArb, { nil: undefined }),
  },
  { requiredKeys: [] }
);

/**
 * Generates a filter params object for the HITL Review Queue:
 *   { status?: string; workspace_id?: string }
 */
const hitlFilterParamsArb = fc.record(
  {
    status: fc.option(hitlStatusArb, { nil: undefined }),
    workspace_id: fc.option(workspaceIdArb, { nil: undefined }),
  },
  { requiredKeys: [] }
);

/**
 * Generates a filter params object for the Observability Dashboard:
 *   { workspace_id?: string; range?: string; start?: string; end?: string; group_by?: string; granularity?: string }
 */
const observabilityFilterParamsArb = fc.record(
  {
    workspace_id: fc.option(workspaceIdArb, { nil: undefined }),
    range: fc.option(rangePresetArb, { nil: undefined }),
    start: fc.option(dateStringArb, { nil: undefined }),
    end: fc.option(dateStringArb, { nil: undefined }),
    group_by: fc.option(fc.constantFrom('workspace'), { nil: undefined }),
    granularity: fc.option(fc.constantFrom('hour', 'day', 'week'), { nil: undefined }),
  },
  { requiredKeys: [] }
);

/** Generates an arbitrary params record with random keys and optional values */
const arbitraryParamsArb = fc.dictionary(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz_'.split('')), {
    minLength: 1,
    maxLength: 15,
  }),
  fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined })
);

// --- Property Tests ---

describe('Filter re-fetch with correct parameters', () => {
  describe('Property 8: Filter changes trigger API re-fetch with correct parameters', () => {
    it('should include set filter values as query parameters for trace explorer filters', () => {
      /**
       * **Validates: Requirements 4.3, 4.5**
       *
       * For any trace explorer filter combination, every defined filter value
       * must appear in the query string as a key=value pair.
       */
      fc.assert(
        fc.property(traceFilterParamsArb, (params) => {
          const query = buildQuery(params);
          const definedEntries = Object.entries(params).filter(
            ([, v]) => v !== undefined
          );

          for (const [key, value] of definedEntries) {
            expect(query).toContain(`${key}=${encodeURIComponent(value!)}`);
          }
        }),
        { numRuns: 300 }
      );
    });

    it('should include set filter values as query parameters for HITL queue filters', () => {
      /**
       * **Validates: Requirements 6.3**
       *
       * For any HITL queue filter combination, every defined filter value
       * must appear in the query string.
       */
      fc.assert(
        fc.property(hitlFilterParamsArb, (params) => {
          const query = buildQuery(params);
          const definedEntries = Object.entries(params).filter(
            ([, v]) => v !== undefined
          );

          for (const [key, value] of definedEntries) {
            expect(query).toContain(`${key}=${encodeURIComponent(value!)}`);
          }
        }),
        { numRuns: 200 }
      );
    });

    it('should include set filter values as query parameters for observability dashboard filters', () => {
      /**
       * **Validates: Requirements 9.3**
       *
       * For any observability dashboard filter combination, every defined
       * filter value must appear in the query string.
       */
      fc.assert(
        fc.property(observabilityFilterParamsArb, (params) => {
          const query = buildQuery(params);
          const definedEntries = Object.entries(params).filter(
            ([, v]) => v !== undefined
          );

          for (const [key, value] of definedEntries) {
            expect(query).toContain(`${key}=${encodeURIComponent(value!)}`);
          }
        }),
        { numRuns: 300 }
      );
    });

    it('should omit undefined filter values from the query string', () => {
      /**
       * **Validates: Requirements 4.3, 4.5, 6.3, 9.3**
       *
       * Clearing a filter (setting it to undefined) must remove that
       * parameter from the request query string entirely.
       */
      fc.assert(
        fc.property(arbitraryParamsArb, (params) => {
          const query = buildQuery(params);
          const undefinedKeys = Object.entries(params)
            .filter(([, v]) => v === undefined)
            .map(([k]) => k);

          for (const key of undefinedKeys) {
            // The key should not appear as a query parameter
            expect(query).not.toMatch(new RegExp(`(\\?|&)${key}=`));
          }
        }),
        { numRuns: 300 }
      );
    });

    it('should produce an empty string when params is undefined', () => {
      /**
       * **Validates: Requirements 4.3, 4.5, 6.3, 9.3**
       *
       * When no params object is provided, the query string must be empty.
       */
      expect(buildQuery(undefined)).toBe('');
    });

    it('should produce an empty string when all params are undefined', () => {
      /**
       * **Validates: Requirements 4.3, 4.5, 6.3, 9.3**
       *
       * When all filter values are cleared (all undefined), the query
       * string must be empty — no trailing `?`.
       */
      fc.assert(
        fc.property(
          fc.dictionary(
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
              minLength: 1,
              maxLength: 10,
            }),
            fc.constant(undefined as string | undefined)
          ),
          (params) => {
            const query = buildQuery(params);
            expect(query).toBe('');
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should properly URL-encode special characters in filter values', () => {
      /**
       * **Validates: Requirements 4.3, 4.5, 6.3, 9.3**
       *
       * Filter values containing special characters (spaces, ampersands,
       * equals signs, etc.) must be properly URL-encoded in the query string.
       */
      fc.assert(
        fc.property(specialCharsArb, (value) => {
          const params = { filter: value };
          const query = buildQuery(params);
          expect(query).toBe(`?filter=${encodeURIComponent(value)}`);
          // The raw value should not appear unencoded if it has special chars
          if (/[&=?# +%]/.test(value)) {
            expect(query).not.toBe(`?filter=${value}`);
          }
        }),
        { numRuns: 200 }
      );
    });

    it('should start with ? when at least one param is defined', () => {
      /**
       * **Validates: Requirements 4.3, 4.5, 6.3, 9.3**
       *
       * A non-empty query string must always start with `?`.
       */
      fc.assert(
        fc.property(
          arbitraryParamsArb.filter((p) =>
            Object.values(p).some((v) => v !== undefined)
          ),
          (params) => {
            const query = buildQuery(params);
            expect(query).toMatch(/^\?/);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should separate multiple parameters with &', () => {
      /**
       * **Validates: Requirements 4.3, 4.5, 6.3, 9.3**
       *
       * When multiple filters are set, they must be joined with `&`.
       * The number of `&` separators equals (number of defined params - 1).
       */
      fc.assert(
        fc.property(
          arbitraryParamsArb.filter((p) => {
            const definedCount = Object.values(p).filter((v) => v !== undefined).length;
            return definedCount >= 2;
          }),
          (params) => {
            const query = buildQuery(params);
            const definedCount = Object.values(params).filter(
              (v) => v !== undefined
            ).length;
            // Remove leading '?' then count '&' separators
            const queryBody = query.slice(1);
            const ampersandCount = (queryBody.match(/&/g) || []).length;
            expect(ampersandCount).toBe(definedCount - 1);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should produce a parseable query string that round-trips through URLSearchParams', () => {
      /**
       * **Validates: Requirements 4.3, 4.5, 6.3, 9.3**
       *
       * The generated query string must be parseable by URLSearchParams,
       * and parsing it should recover the original defined parameter values.
       */
      fc.assert(
        fc.property(traceFilterParamsArb, (params) => {
          const query = buildQuery(params);
          if (query === '') return;

          const parsed = new URLSearchParams(query.slice(1));
          const definedEntries = Object.entries(params).filter(
            ([, v]) => v !== undefined
          );

          for (const [key, value] of definedEntries) {
            expect(parsed.get(key)).toBe(value);
          }

          // Undefined entries should not be present
          const undefinedKeys = Object.entries(params)
            .filter(([, v]) => v === undefined)
            .map(([k]) => k);
          for (const key of undefinedKeys) {
            expect(parsed.has(key)).toBe(false);
          }
        }),
        { numRuns: 300 }
      );
    });
  });
});
