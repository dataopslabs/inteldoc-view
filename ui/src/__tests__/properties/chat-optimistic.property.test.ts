/**
 * Property-based tests for optimistic chat message display.
 *
 * **Validates: Requirements 8.5, 8.8**
 *
 * Property 10: Optimistic chat message display followed by server confirmation
 *
 * We extract the optimistic update logic from the chat page's sendMessage callback
 * and test it as pure state transitions:
 * - After sending: user message appears immediately in the thread
 * - After server response: assistant message is appended
 * - On error: user message remains, error is shown, message input is restored
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// --- Types mirroring chat page ---

interface DisplayMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: string;
  tokens?: { input: number; output: number };
}

interface ChatResponse {
  response: string;
  message_count: number;
  tokens: { input: number; output: number };
}

interface ChatState {
  messages: DisplayMessage[];
  messageInput: string;
  sending: boolean;
}

// --- Extracted state transitions from ChatPage.sendMessage ---

/**
 * State before sending: user has typed a message and the thread has existing messages.
 */
function createInitialState(
  existingMessages: DisplayMessage[],
  inputText: string
): ChatState {
  return {
    messages: [...existingMessages],
    messageInput: inputText,
    sending: false,
  };
}

/**
 * Optimistic update: user message is appended immediately, input is cleared, sending=true.
 * Mirrors the sendMessage callback:
 *   setMessage('');
 *   setSending(true);
 *   setMessages((prev) => [...prev, userDisplay]);
 */
function applyOptimisticSend(state: ChatState): ChatState {
  const userMsg = state.messageInput.trim();
  const userDisplay: DisplayMessage = {
    role: 'user',
    content: userMsg,
    timestamp: new Date().toISOString(),
  };
  return {
    messages: [...state.messages, userDisplay],
    messageInput: '',
    sending: true,
  };
}

/**
 * Server success: assistant message is appended, sending=false.
 * Mirrors the success path in sendMessage:
 *   setMessages((prev) => [...prev, assistantDisplay]);
 *   setSending(false);
 */
function applyServerSuccess(state: ChatState, response: ChatResponse): ChatState {
  const assistantDisplay: DisplayMessage = {
    role: 'assistant',
    content: response.response,
    timestamp: new Date().toISOString(),
    tokens: response.tokens,
  };
  return {
    messages: [...state.messages, assistantDisplay],
    messageInput: state.messageInput,
    sending: false,
  };
}

/**
 * Server error: error message is appended, original user message is restored to input, sending=false.
 * Mirrors the error path in sendMessage:
 *   setMessages((prev) => [...prev, errorDisplay]);
 *   setMessage(userMsg);
 *   setSending(false);
 */
function applyServerError(state: ChatState, errorMsg: string, originalInput: string): ChatState {
  const errorDisplay: DisplayMessage = {
    role: 'error',
    content: errorMsg,
    timestamp: new Date().toISOString(),
  };
  return {
    messages: [...state.messages, errorDisplay],
    messageInput: originalInput,
    sending: false,
  };
}

// --- Generators ---

const timestampArb = fc
  .date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') })
  .map((d) => d.toISOString());

const contentArb = fc.string({ minLength: 1, maxLength: 200 });

const displayMessageArb: fc.Arbitrary<DisplayMessage> = fc.record({
  role: fc.constantFrom('user' as const, 'assistant' as const),
  content: contentArb,
  timestamp: timestampArb,
});

/** Generates an array of existing messages (conversation history) */
const existingMessagesArb = fc.array(displayMessageArb, { minLength: 0, maxLength: 20 });

/** Generates a non-empty, trimmable user input (with possible whitespace) */
const userInputArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/** Generates a server chat response */
const chatResponseArb = fc.record({
  response: contentArb,
  message_count: fc.integer({ min: 1, max: 1000 }),
  tokens: fc.record({
    input: fc.integer({ min: 0, max: 10000 }),
    output: fc.integer({ min: 0, max: 10000 }),
  }),
});

/** Generates an error message string */
const errorMsgArb = fc.string({ minLength: 1, maxLength: 100 });

// --- Property Tests ---

describe('Optimistic chat message display', () => {
  describe('Property 10: Optimistic chat message display followed by server confirmation', () => {
    it('after sending, the user message appears immediately in the thread', () => {
      /**
       * **Validates: Requirements 8.5, 8.8**
       *
       * For any existing conversation and user input, after the optimistic
       * send, the user message should be the last message in the thread.
       */
      fc.assert(
        fc.property(existingMessagesArb, userInputArb, (existing, input) => {
          const initial = createInitialState(existing, input);
          const afterSend = applyOptimisticSend(initial);

          // User message is appended at the end
          expect(afterSend.messages).toHaveLength(existing.length + 1);
          const lastMsg = afterSend.messages[afterSend.messages.length - 1];
          expect(lastMsg.role).toBe('user');
          expect(lastMsg.content).toBe(input.trim());
        }),
        { numRuns: 200 }
      );
    });

    it('after sending, the message input is cleared and sending is true', () => {
      /**
       * **Validates: Requirements 8.5, 8.8**
       *
       * The input field should be cleared immediately and the sending
       * flag should be true while waiting for the server response.
       */
      fc.assert(
        fc.property(existingMessagesArb, userInputArb, (existing, input) => {
          const initial = createInitialState(existing, input);
          const afterSend = applyOptimisticSend(initial);

          expect(afterSend.messageInput).toBe('');
          expect(afterSend.sending).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('after server response, the assistant message is appended', () => {
      /**
       * **Validates: Requirements 8.5, 8.8**
       *
       * After a successful server response, the assistant message should
       * be appended after the user message, and sending should be false.
       */
      fc.assert(
        fc.property(
          existingMessagesArb,
          userInputArb,
          chatResponseArb,
          (existing, input, response) => {
            const initial = createInitialState(existing, input);
            const afterSend = applyOptimisticSend(initial);
            const afterResponse = applyServerSuccess(afterSend, response);

            // Thread has existing + user + assistant
            expect(afterResponse.messages).toHaveLength(existing.length + 2);

            // User message is second-to-last
            const userMsg = afterResponse.messages[existing.length];
            expect(userMsg.role).toBe('user');
            expect(userMsg.content).toBe(input.trim());

            // Assistant message is last
            const assistantMsg = afterResponse.messages[existing.length + 1];
            expect(assistantMsg.role).toBe('assistant');
            expect(assistantMsg.content).toBe(response.response);
            expect(assistantMsg.tokens).toEqual(response.tokens);

            // Sending is done
            expect(afterResponse.sending).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('on error, the user message remains visible and error is shown', () => {
      /**
       * **Validates: Requirements 8.5, 8.8**
       *
       * If the API call fails, the user message should remain in the thread,
       * an error message should be appended, and no assistant message should appear.
       */
      fc.assert(
        fc.property(
          existingMessagesArb,
          userInputArb,
          errorMsgArb,
          (existing, input, errorMsg) => {
            const initial = createInitialState(existing, input);
            const afterSend = applyOptimisticSend(initial);
            const afterError = applyServerError(afterSend, errorMsg, input.trim());

            // Thread has existing + user + error
            expect(afterError.messages).toHaveLength(existing.length + 2);

            // User message is still there
            const userMsg = afterError.messages[existing.length];
            expect(userMsg.role).toBe('user');
            expect(userMsg.content).toBe(input.trim());

            // Error message is last
            const errMsg = afterError.messages[existing.length + 1];
            expect(errMsg.role).toBe('error');
            expect(errMsg.content).toBe(errorMsg);

            // No assistant message exists after the user message
            const rolesAfterExisting = afterError.messages
              .slice(existing.length)
              .map((m) => m.role);
            expect(rolesAfterExisting).not.toContain('assistant');
          }
        ),
        { numRuns: 200 }
      );
    });

    it('on error, the message input is restored with the original text', () => {
      /**
       * **Validates: Requirements 8.5, 8.8**
       *
       * If the API call fails, the message input should be restored
       * so the user can retry without retyping.
       */
      fc.assert(
        fc.property(
          existingMessagesArb,
          userInputArb,
          errorMsgArb,
          (existing, input, errorMsg) => {
            const initial = createInitialState(existing, input);
            const afterSend = applyOptimisticSend(initial);

            // Input was cleared after optimistic send
            expect(afterSend.messageInput).toBe('');

            const afterError = applyServerError(afterSend, errorMsg, input.trim());

            // Input is restored on error
            expect(afterError.messageInput).toBe(input.trim());
            expect(afterError.sending).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('existing messages are never modified during the send lifecycle', () => {
      /**
       * **Validates: Requirements 8.5, 8.8**
       *
       * Throughout the entire send lifecycle (optimistic → success or error),
       * the existing messages in the thread should remain unchanged.
       */
      fc.assert(
        fc.property(
          existingMessagesArb,
          userInputArb,
          chatResponseArb,
          errorMsgArb,
          (existing, input, response, errorMsg) => {
            const initial = createInitialState(existing, input);

            // After optimistic send
            const afterSend = applyOptimisticSend(initial);
            for (let i = 0; i < existing.length; i++) {
              expect(afterSend.messages[i]).toEqual(existing[i]);
            }

            // After success
            const afterSuccess = applyServerSuccess(afterSend, response);
            for (let i = 0; i < existing.length; i++) {
              expect(afterSuccess.messages[i]).toEqual(existing[i]);
            }

            // After error (from a fresh optimistic send)
            const afterSend2 = applyOptimisticSend(createInitialState(existing, input));
            const afterError = applyServerError(afterSend2, errorMsg, input.trim());
            for (let i = 0; i < existing.length; i++) {
              expect(afterError.messages[i]).toEqual(existing[i]);
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
