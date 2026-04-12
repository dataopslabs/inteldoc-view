/**
 * Property-based tests for ConfidenceIndicator color thresholds.
 *
 * **Validates: Requirements 12.4**
 *
 * Property 4: Confidence indicator color thresholds are consistent
 *
 * We test the getConfidenceColor function directly to verify that:
 * - Values >= 0.8 always return green (#27a644)
 * - Values >= 0.5 and < 0.8 always return amber (#f59e0b)
 * - Values < 0.5 always return red (#ef4444)
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { getConfidenceColor } from '../../components/ConfidenceIndicator';

// --- Constants ---

const GREEN = '#27a644';
const AMBER = '#f59e0b';
const RED = '#ef4444';

// --- Generators ---

/** Generates a confidence value in the green range [0.8, 1.0] */
const greenRangeArb = fc.double({ min: 0.8, max: 1.0, noNaN: true });

/** Generates a confidence value in the amber range [0.5, 0.8) */
const amberRangeArb = fc.double({ min: 0.5, max: 0.7999999999, noNaN: true });

/** Generates a confidence value in the red range [0, 0.5) */
const redRangeArb = fc.double({ min: 0, max: 0.4999999999, noNaN: true });

// --- Property Tests ---

describe('ConfidenceIndicator color thresholds', () => {
  describe('Property 4: Confidence indicator color thresholds are consistent', () => {
    it('should return green for any value >= 0.8', () => {
      /**
       * **Validates: Requirements 12.4**
       *
       * For any confidence value in [0.8, 1.0], the color should be green.
       */
      fc.assert(
        fc.property(greenRangeArb, (value) => {
          expect(getConfidenceColor(value)).toBe(GREEN);
        }),
        { numRuns: 200 }
      );
    });

    it('should return amber for any value >= 0.5 and < 0.8', () => {
      /**
       * **Validates: Requirements 12.4**
       *
       * For any confidence value in [0.5, 0.8), the color should be amber.
       */
      fc.assert(
        fc.property(amberRangeArb, (value) => {
          expect(getConfidenceColor(value)).toBe(AMBER);
        }),
        { numRuns: 200 }
      );
    });

    it('should return red for any value < 0.5', () => {
      /**
       * **Validates: Requirements 12.4**
       *
       * For any confidence value in [0, 0.5), the color should be red.
       */
      fc.assert(
        fc.property(redRangeArb, (value) => {
          expect(getConfidenceColor(value)).toBe(RED);
        }),
        { numRuns: 200 }
      );
    });

    it('should return green at the exact boundary 0.8', () => {
      /**
       * **Validates: Requirements 12.4**
       */
      expect(getConfidenceColor(0.8)).toBe(GREEN);
    });

    it('should return amber at the exact boundary 0.5', () => {
      /**
       * **Validates: Requirements 12.4**
       */
      expect(getConfidenceColor(0.5)).toBe(AMBER);
    });

    it('should return red at 0', () => {
      /**
       * **Validates: Requirements 12.4**
       */
      expect(getConfidenceColor(0)).toBe(RED);
    });

    it('should return green at 1.0', () => {
      /**
       * **Validates: Requirements 12.4**
       */
      expect(getConfidenceColor(1.0)).toBe(GREEN);
    });

    it('should always return one of the three valid colors for any value in [0, 1]', () => {
      /**
       * **Validates: Requirements 12.4**
       *
       * For any confidence value in [0, 1], the returned color must be
       * one of the three defined threshold colors.
       */
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (value) => {
          const color = getConfidenceColor(value);
          expect([GREEN, AMBER, RED]).toContain(color);
        }),
        { numRuns: 500 }
      );
    });
  });
});
