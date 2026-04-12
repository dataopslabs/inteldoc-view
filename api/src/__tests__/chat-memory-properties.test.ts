import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  truncateMemory,
  estimateTokens,
  MEMORY_TOKEN_BUDGET,
  MIN_RECENT_EXCHANGES,
} from '../handlers/chat';
import { MemoryEntry } from '../models/types';

/**
 * Chat Memory System — Property-Based Tests
 *
 * Pure logic tests for memory truncation and token estimation.
 * Uses fast-check to verify universal properties across random inputs.
 */

// --- Arbitraries ---

/** Generate a single MemoryEntry with random content */
const memoryEntryArb = (role: 'user' | 'assistant'): fc.Arbitrary<MemoryEntry> =>
  fc.string({ minLength: 1, maxLength: 2000 }).map((content) => ({
    role,
    content,
    timestamp: new Date().toISOString(),
  }));

/** Generate a valid memory array (alternating user/assistant pairs) */
const memoryArrayArb = (minPairs = 0, maxPairs = 30): fc.Arbitrary<MemoryEntry[]> =>
  fc.integer({ min: minPairs, max: maxPairs }).chain((numPairs) =>
    fc.tuple(
      ...Array.from({ length: numPairs }, () =>
        fc.tuple(memoryEntryArb('user'), memoryEntryArb('assistant'))
      )
    ).map((pairs) => pairs.flat())
  );

const MIN_MESSAGES = MIN_RECENT_EXCHANGES * 2; // 4

describe('Chat Memory Property Tests — Truncation and Token Estimation', () => {
  /**
   * Property 1: Memory truncation preserves minimum recent exchanges
   *
   * For any memory array with at least MIN_RECENT_EXCHANGES * 2 entries,
   * the truncated result always has at least that many entries.
   *
   * **Validates: Requirements 6.1, 6.2**
   */
  it('Property 1: memory truncation preserves minimum recent exchanges', () => {
    fc.assert(
      fc.property(
        memoryArrayArb(2, 30), // at least 2 pairs = 4 entries
        (memory) => {
          const result = truncateMemory(memory);

          // When original has >= 4 entries, result must have >= 4
          expect(result.length).toBeGreaterThanOrEqual(MIN_MESSAGES);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * Property 2: Memory truncation removes oldest entries first
   *
   * The truncated result is always a contiguous suffix of the original array.
   * This means only leading entries are removed and ordering is preserved.
   *
   * **Validates: Requirements 6.1**
   */
  it('Property 2: memory truncation removes oldest entries first', () => {
    fc.assert(
      fc.property(
        memoryArrayArb(1, 30),
        (memory) => {
          const result = truncateMemory(memory);

          // Result must be a suffix of the original
          const offset = memory.length - result.length;
          expect(offset).toBeGreaterThanOrEqual(0);

          for (let i = 0; i < result.length; i++) {
            expect(result[i].content).toBe(memory[offset + i].content);
            expect(result[i].role).toBe(memory[offset + i].role);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * Property 3: Truncated memory token count is within budget or at minimum size
   *
   * After truncation, either the estimated token count is within MEMORY_TOKEN_BUDGET,
   * or the window is at the minimum size (4 messages).
   *
   * **Validates: Requirements 6.1, 6.2**
   */
  it('Property 3: truncated memory is within budget or at minimum size', () => {
    fc.assert(
      fc.property(
        memoryArrayArb(0, 30),
        (memory) => {
          const result = truncateMemory(memory);
          const tokens = estimateTokens(result);

          // Either within budget OR at minimum size
          const withinBudget = tokens <= MEMORY_TOKEN_BUDGET;
          const atMinimumSize = result.length <= MIN_MESSAGES;

          expect(withinBudget || atMinimumSize).toBe(true);
        }
      ),
      { numRuns: 500 }
    );
  });

  /**
   * Property 9: Token estimation is proportional to content length
   *
   * For any list of MemoryEntry items, the estimated token count equals
   * the sum of ceil(content.length / 4) for each entry.
   *
   * **Validates: Requirements 6.4**
   */
  it('Property 9: token estimation equals sum of ceil(content.length / 4)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 0, maxLength: 5000 }).map((content) => ({
            role: 'user' as const,
            content,
            timestamp: new Date().toISOString(),
          })),
          { minLength: 0, maxLength: 20 }
        ),
        (entries) => {
          const result = estimateTokens(entries);
          const expected = entries.reduce(
            (sum, e) => sum + Math.ceil(e.content.length / 4),
            0
          );

          expect(result).toBe(expected);
        }
      ),
      { numRuns: 500 }
    );
  });
});
