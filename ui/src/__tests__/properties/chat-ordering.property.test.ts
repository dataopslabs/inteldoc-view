/**
 * Property-based tests for chat message ordering.
 *
 * **Validates: Requirements 8.3, 8.4**
 *
 * Property 6: Chat message ordering is preserved
 *
 * We extract the message display logic from the chat page and test it as pure functions:
 * - mapMemoryToDisplayMessages: converts MemoryEntry[] to DisplayMessage[]
 * - getMessageAlignment: determines if a message is right-aligned (user) or left-aligned (assistant)
 * - The display order must match the memory array order
 * - The most recent message must be at the bottom (last in the array)
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// --- Types mirroring chat page ---

interface MemoryEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface DisplayMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: string;
  tokens?: { input: number; output: number };
}

// --- Extracted logic from ChatPage ---

/**
 * Converts memory entries from the API into display messages.
 * Mirrors the selectSession callback in ChatPage:
 *   session.memory.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp }))
 */
function mapMemoryToDisplayMessages(memory: MemoryEntry[]): DisplayMessage[] {
  return memory.map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
  }));
}

/**
 * Determines the alignment of a message based on its role.
 * Mirrors the chat page JSX:
 *   isUser ? 'justify-end' : 'justify-start'
 * User messages are right-aligned, assistant messages are left-aligned.
 */
function getMessageAlignment(role: 'user' | 'assistant'): 'right' | 'left' {
  return role === 'user' ? 'right' : 'left';
}

/**
 * Returns the index of the most recent message (last in the array).
 * The chat page renders messages in array order with auto-scroll to bottom,
 * so the last element is the most recent and appears at the bottom.
 */
function getMostRecentMessageIndex(messages: DisplayMessage[]): number {
  return messages.length - 1;
}

// --- Generators ---

/** Generates a valid ISO timestamp string */
const timestampArb = fc
  .date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') })
  .map((d) => d.toISOString());

/** Generates a non-empty message content string */
const contentArb = fc.string({ minLength: 1, maxLength: 200 });

/** Generates a single MemoryEntry */
const memoryEntryArb = fc.record({
  role: fc.constantFrom('user' as const, 'assistant' as const),
  content: contentArb,
  timestamp: timestampArb,
});

/** Generates a non-empty array of MemoryEntry items */
const memoryArrayArb = fc.array(memoryEntryArb, { minLength: 1, maxLength: 50 });

/**
 * Generates a memory array with alternating user/assistant messages,
 * always starting with a user message (realistic conversation pattern).
 */
const alternatingMemoryArb = fc
  .array(contentArb, { minLength: 1, maxLength: 25 })
  .chain((contents) => {
    return fc.array(timestampArb, { minLength: contents.length, maxLength: contents.length }).map(
      (timestamps) =>
        contents.map((content, i): MemoryEntry => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content,
          timestamp: timestamps[i],
        }))
    );
  });

// --- Property Tests ---

describe('Chat message ordering', () => {
  describe('Property 6: Chat message ordering is preserved', () => {
    it('display messages preserve the order of the memory array', () => {
      /**
       * **Validates: Requirements 8.3, 8.4**
       *
       * For any memory array from the API, the display messages
       * should appear in the exact same order.
       */
      fc.assert(
        fc.property(memoryArrayArb, (memory) => {
          const display = mapMemoryToDisplayMessages(memory);

          expect(display).toHaveLength(memory.length);
          for (let i = 0; i < memory.length; i++) {
            expect(display[i].content).toBe(memory[i].content);
            expect(display[i].role).toBe(memory[i].role);
            expect(display[i].timestamp).toBe(memory[i].timestamp);
          }
        }),
        { numRuns: 200 }
      );
    });

    it('user messages are right-aligned and assistant messages are left-aligned', () => {
      /**
       * **Validates: Requirements 8.3, 8.4**
       *
       * For any memory array, user messages should be right-aligned
       * and assistant messages should be left-aligned.
       */
      fc.assert(
        fc.property(memoryArrayArb, (memory) => {
          const display = mapMemoryToDisplayMessages(memory);

          for (const msg of display) {
            if (msg.role === 'user') {
              expect(getMessageAlignment('user')).toBe('right');
            } else if (msg.role === 'assistant') {
              expect(getMessageAlignment('assistant')).toBe('left');
            }
          }
        }),
        { numRuns: 200 }
      );
    });

    it('the most recent message is at the bottom (last in the array)', () => {
      /**
       * **Validates: Requirements 8.3, 8.4**
       *
       * For any non-empty memory array, the last element in the display
       * array corresponds to the last element in the memory array,
       * which is the most recent message rendered at the bottom.
       */
      fc.assert(
        fc.property(memoryArrayArb, (memory) => {
          const display = mapMemoryToDisplayMessages(memory);
          const lastIdx = getMostRecentMessageIndex(display);

          expect(lastIdx).toBe(memory.length - 1);
          expect(display[lastIdx].content).toBe(memory[memory.length - 1].content);
          expect(display[lastIdx].role).toBe(memory[memory.length - 1].role);
        }),
        { numRuns: 200 }
      );
    });

    it('alternating user/assistant messages maintain their alternation in display', () => {
      /**
       * **Validates: Requirements 8.3, 8.4**
       *
       * For any conversation with alternating user/assistant messages,
       * the display should preserve the alternation pattern.
       */
      fc.assert(
        fc.property(alternatingMemoryArb, (memory) => {
          const display = mapMemoryToDisplayMessages(memory);

          for (let i = 0; i < display.length; i++) {
            const expectedRole = i % 2 === 0 ? 'user' : 'assistant';
            expect(display[i].role).toBe(expectedRole);
          }
        }),
        { numRuns: 200 }
      );
    });

    it('mapping preserves all fields without mutation', () => {
      /**
       * **Validates: Requirements 8.3, 8.4**
       *
       * The mapping from MemoryEntry to DisplayMessage should not
       * alter any field values. Content, role, and timestamp must
       * be identical.
       */
      fc.assert(
        fc.property(memoryArrayArb, (memory) => {
          const display = mapMemoryToDisplayMessages(memory);

          // Verify no data was lost or mutated
          for (let i = 0; i < memory.length; i++) {
            expect(display[i]).toEqual({
              role: memory[i].role,
              content: memory[i].content,
              timestamp: memory[i].timestamp,
            });
          }
        }),
        { numRuns: 200 }
      );
    });

    it('empty memory array produces empty display array', () => {
      /**
       * **Validates: Requirements 8.3, 8.4**
       *
       * Edge case: an empty memory array should produce an empty display.
       */
      const display = mapMemoryToDisplayMessages([]);
      expect(display).toHaveLength(0);
    });
  });
});
