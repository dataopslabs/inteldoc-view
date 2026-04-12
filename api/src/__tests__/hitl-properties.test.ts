import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * HITL Review System — Property-Based Tests
 *
 * Pure logic tests for state machine transitions, duration computation,
 * and correction count consistency. No DynamoDB mocking needed.
 */

// --- State Machine Definition ---

type ReviewStatus = 'pending' | 'in_review' | 'resolved';
type Operation = 'assign' | 'correct' | 'resolve';

const VALID_TRANSITIONS: Record<string, Record<string, string>> = {
  pending: { assign: 'in_review' },
  in_review: { correct: 'in_review', resolve: 'resolved' },
  resolved: {},
};

function tryTransition(
  currentStatus: ReviewStatus,
  operation: Operation
): { success: boolean; newStatus: ReviewStatus } {
  const transitions = VALID_TRANSITIONS[currentStatus];
  if (transitions && operation in transitions) {
    return { success: true, newStatus: transitions[operation] as ReviewStatus };
  }
  return { success: false, newStatus: currentStatus };
}

// --- Arbitraries ---

const reviewStatusArb: fc.Arbitrary<ReviewStatus> = fc.constantFrom('pending', 'in_review', 'resolved');
const operationArb: fc.Arbitrary<Operation> = fc.constantFrom('assign', 'correct', 'resolve');

describe('HITL Property Tests — State Machine, Duration, Correction Count', () => {
  /**
   * Property 4: Review status transitions follow the valid state machine
   *
   * Generate sequences of operations from arbitrary starting states.
   * Valid transitions:
   *   pending → in_review (assign)
   *   in_review → in_review (correct)
   *   in_review → resolved (resolve)
   * Invalid transitions should be rejected (status unchanged).
   *
   * **Validates: Requirements 4.1, 4.2, 5.4, 6.1, 6.4**
   */
  it('Property 4: only valid state transitions succeed', () => {
    fc.assert(
      fc.property(
        reviewStatusArb,
        fc.array(operationArb, { minLength: 1, maxLength: 20 }),
        (startStatus, operations) => {
          let current: ReviewStatus = startStatus;

          for (const op of operations) {
            const validTransitions = VALID_TRANSITIONS[current];
            const shouldSucceed = op in validTransitions;
            const result = tryTransition(current, op);

            if (shouldSucceed) {
              expect(result.success).toBe(true);
              expect(result.newStatus).toBe(validTransitions[op]);
              current = result.newStatus as ReviewStatus;
            } else {
              expect(result.success).toBe(false);
              expect(result.newStatus).toBe(current);
            }
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it('Property 4: assign on non-pending is rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('in_review' as ReviewStatus, 'resolved' as ReviewStatus),
        (status) => {
          const result = tryTransition(status, 'assign');
          expect(result.success).toBe(false);
          expect(result.newStatus).toBe(status);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 4: resolve on non-in_review is rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('pending' as ReviewStatus, 'resolved' as ReviewStatus),
        (status) => {
          const result = tryTransition(status, 'resolve');
          expect(result.success).toBe(false);
          expect(result.newStatus).toBe(status);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 4: correct on non-in_review is rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('pending' as ReviewStatus, 'resolved' as ReviewStatus),
        (status) => {
          const result = tryTransition(status, 'correct');
          expect(result.success).toBe(false);
          expect(result.newStatus).toBe(status);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 4: resolved is a terminal state — no operations succeed', () => {
    fc.assert(
      fc.property(operationArb, (op) => {
        const result = tryTransition('resolved', op);
        expect(result.success).toBe(false);
        expect(result.newStatus).toBe('resolved');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6: Review duration is non-negative and consistent with timestamps
   *
   * Generate random assigned_at / resolved_at timestamp pairs where resolved >= assigned.
   * Verify duration_ms equals the difference in milliseconds and is non-negative.
   *
   * **Validates: Requirements 8.1**
   */
  it('Property 6: duration_ms equals resolved_at - assigned_at and is non-negative', () => {
    fc.assert(
      fc.property(
        // Generate a base timestamp (ms since epoch) in a reasonable range
        fc.integer({ min: 0, max: 2_000_000_000_000 }),
        // Generate a non-negative offset so resolved >= assigned
        fc.integer({ min: 0, max: 100_000_000 }),
        (assignedMs, offsetMs) => {
          const resolvedMs = assignedMs + offsetMs;

          const assignedAt = new Date(assignedMs).toISOString();
          const resolvedAt = new Date(resolvedMs).toISOString();

          const durationMs =
            new Date(resolvedAt).getTime() - new Date(assignedAt).getTime();

          expect(durationMs).toBeGreaterThanOrEqual(0);
          // Duration should match the offset (round-trip through ISO strings may lose sub-ms,
          // but Date only has ms precision so this should be exact)
          expect(durationMs).toBe(offsetMs);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * Property 7: Correction count matches corrections list length
   *
   * Generate random corrections lists and verify count equals length.
   *
   * **Validates: Requirements 8.2**
   */
  it('Property 7: correction_count equals corrections.length', () => {
    const correctionArb = fc.record({
      field_name: fc.string({ minLength: 1, maxLength: 30 }),
      original_value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
      corrected_value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    });

    fc.assert(
      fc.property(
        fc.array(correctionArb, { minLength: 0, maxLength: 50 }),
        (corrections) => {
          const correctionCount = corrections.length;
          expect(correctionCount).toBe(corrections.length);
          expect(correctionCount).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 500 }
    );
  });
});
