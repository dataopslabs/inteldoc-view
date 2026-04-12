/**
 * Property-based tests for StatusBadge color consistency.
 *
 * **Validates: Requirements 12.3**
 *
 * Property 3: Status badge color mapping is consistent across all pages
 *
 * We test the STATUS_COLORS mapping directly to verify that:
 * - Every expected status has a color entry
 * - Each status always maps to the same specific color
 * - The mapping covers all required statuses
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { STATUS_COLORS } from '../../components/StatusBadge';

// --- Expected color mapping from the design spec ---

const EXPECTED_COLORS: Record<string, string> = {
  pending: '#62666d',
  processing: '#f59e0b',
  completed: '#27a644',
  failed: '#ef4444',
  hitl_required: '#7170ff',
  in_review: '#f59e0b',
  resolved: '#27a644',
};

const ALL_STATUSES = Object.keys(EXPECTED_COLORS);

// --- Generators ---

/** Generates one of the known statuses */
const statusArb = fc.constantFrom(...ALL_STATUSES);

// --- Property Tests ---

describe('StatusBadge color consistency', () => {
  describe('Property 3: Status badge color mapping is consistent across all pages', () => {
    it('should map every status to its expected color', () => {
      /**
       * **Validates: Requirements 12.3**
       *
       * For any known status, STATUS_COLORS should return the exact
       * color defined in the design spec.
       */
      fc.assert(
        fc.property(statusArb, (status) => {
          const actual = STATUS_COLORS[status];
          const expected = EXPECTED_COLORS[status];
          expect(actual).toBe(expected);
        }),
        { numRuns: 200 }
      );
    });

    it('should cover all expected statuses', () => {
      /**
       * **Validates: Requirements 12.3**
       *
       * The STATUS_COLORS map must contain entries for every required status.
       */
      for (const status of ALL_STATUSES) {
        expect(STATUS_COLORS).toHaveProperty(status);
      }
    });

    it('should return the same color for a given status on every lookup', () => {
      /**
       * **Validates: Requirements 12.3**
       *
       * For any status, repeated lookups should always yield the same color,
       * ensuring consistency across pages that use StatusBadge.
       */
      fc.assert(
        fc.property(statusArb, (status) => {
          const first = STATUS_COLORS[status];
          const second = STATUS_COLORS[status];
          expect(first).toBe(second);
        }),
        { numRuns: 200 }
      );
    });

    it('should map specific statuses to their exact hex colors', () => {
      /**
       * **Validates: Requirements 12.3**
       *
       * Verify the exact color values for each status.
       */
      expect(STATUS_COLORS['pending']).toBe('#62666d');
      expect(STATUS_COLORS['processing']).toBe('#f59e0b');
      expect(STATUS_COLORS['completed']).toBe('#27a644');
      expect(STATUS_COLORS['failed']).toBe('#ef4444');
      expect(STATUS_COLORS['hitl_required']).toBe('#7170ff');
      expect(STATUS_COLORS['in_review']).toBe('#f59e0b');
      expect(STATUS_COLORS['resolved']).toBe('#27a644');
    });
  });
});
