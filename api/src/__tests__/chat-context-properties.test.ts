import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { retrieveContext, CONTEXT_TOKEN_BUDGET } from '../handlers/chat';

/**
 * Chat Context System — Property-Based Tests
 *
 * Tests context retrieval and truncation properties.
 * Uses aws-sdk-client-mock to mock DynamoDB responses.
 */

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

// --- Arbitraries ---

/** Generate a single trace field */
const traceFieldArb = fc.record({
  field_name: fc.string({ minLength: 1, maxLength: 50 }),
  value: fc.string({ minLength: 1, maxLength: 500 }),
});

/** Generate a completed trace record with fields */
const completedTraceArb = fc.record({
  trace_id: fc.uuid(),
  workspace_id: fc.constant('ws-test'),
  status: fc.constant('completed'),
  filename: fc.string({ minLength: 1, maxLength: 50 }),
  fields: fc.array(traceFieldArb, { minLength: 1, maxLength: 10 }),
  created_at: fc.integer({
    min: new Date('2023-01-01').getTime(),
    max: new Date('2025-01-01').getTime(),
  }).map((ms) => new Date(ms).toISOString()),
});

describe('Chat Context Property Tests — Context Truncation', () => {
  /**
   * Property 5: Context truncation respects token budget
   *
   * For any set of completed traces, the formatted context string's
   * estimated token count does not exceed the context token budget.
   * Traces are removed oldest-first when truncation is needed.
   *
   * **Validates: Requirements 5.5**
   */
  it('Property 5: context truncation respects token budget', () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(completedTraceArb, { minLength: 1, maxLength: 20 }),
        async (traces) => {
          ddbMock.reset();
          ddbMock.on(QueryCommand).resolves({ Items: traces });

          const context = await retrieveContext('ws-test');

          // Estimate tokens using the same chars/4 approximation
          const estimatedTokens = Math.ceil(context.length / 4);

          // Context must fit within budget
          expect(estimatedTokens).toBeLessThanOrEqual(CONTEXT_TOKEN_BUDGET);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// --- Additional Arbitraries for Properties 4 and 12 ---

/** Possible trace statuses */
const traceStatusArb = fc.constantFrom('completed', 'pending', 'failed', 'processing');

/** Generate a trace record with a random status */
const mixedStatusTraceArb = fc.record({
  trace_id: fc.uuid(),
  workspace_id: fc.constant('ws-test'),
  status: traceStatusArb,
  filename: fc.string({ minLength: 1, maxLength: 50 }),
  fields: fc.array(traceFieldArb, { minLength: 1, maxLength: 5 }),
  created_at: fc.integer({
    min: new Date('2023-01-01').getTime(),
    max: new Date('2025-01-01').getTime(),
  }).map((ms) => new Date(ms).toISOString()),
});

// ═══════════════════════════════════════════════════════════════════
// Property 4: Context retrieval only includes completed traces
// ═══════════════════════════════════════════════════════════════════

describe('Chat Context Property Tests — Completed Traces Only', () => {
  /**
   * Property 4: Context retrieval only includes completed traces
   *
   * For any workspace with a mix of trace statuses, the context string
   * produced by the Context_Retriever contains field data only from
   * traces with status `completed`.
   *
   * **Validates: Requirements 5.1**
   */
  it('Property 4: context retrieval only includes completed traces', () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(mixedStatusTraceArb, { minLength: 1, maxLength: 15 }),
        async (traces) => {
          ddbMock.reset();
          ddbMock.on(QueryCommand).resolves({ Items: traces });

          const context = await retrieveContext('ws-test');

          // Identify completed and non-completed traces
          const completedTraces = traces.filter(
            (t) => t.status === 'completed' && t.fields && t.fields.length > 0
          );
          const nonCompletedTraces = traces.filter((t) => t.status !== 'completed');

          if (completedTraces.length === 0) {
            // No completed traces → context should be empty
            expect(context).toBe('');
          } else {
            // Context should contain trace_ids from completed traces only
            // (some may be truncated due to token budget, but none from non-completed)
            for (const trace of nonCompletedTraces) {
              expect(context).not.toContain(trace.trace_id);
            }

            // At least one completed trace_id should appear (the newest ones)
            const anyCompletedPresent = completedTraces.some((t) =>
              context.includes(t.trace_id)
            );
            expect(anyCompletedPresent).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Property 12: Context retrieval does not leak cross-workspace data
// ═══════════════════════════════════════════════════════════════════

/** Generate a completed trace for a specific workspace */
const traceForWorkspaceArb = (wsId: string) =>
  fc.record({
    trace_id: fc.uuid(),
    workspace_id: fc.constant(wsId),
    status: fc.constant('completed'),
    filename: fc.string({ minLength: 1, maxLength: 50 }),
    fields: fc.array(traceFieldArb, { minLength: 1, maxLength: 5 }),
    created_at: fc.integer({
      min: new Date('2023-01-01').getTime(),
      max: new Date('2025-01-01').getTime(),
    }).map((ms) => new Date(ms).toISOString()),
  });

describe('Chat Context Property Tests — Cross-Workspace Isolation', () => {
  /**
   * Property 12: Context retrieval does not leak cross-workspace data
   *
   * For any chat session scoped to workspace W, the Context_Retriever only
   * queries traces belonging to workspace W. No trace data from other
   * workspaces appears in the context.
   *
   * **Validates: Requirements 8.4**
   */
  it('Property 12: context retrieval does not leak cross-workspace data', () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(traceForWorkspaceArb('ws-target'), { minLength: 1, maxLength: 5 }),
        fc.array(traceForWorkspaceArb('ws-other-1'), { minLength: 1, maxLength: 5 }),
        fc.array(traceForWorkspaceArb('ws-other-2'), { minLength: 1, maxLength: 5 }),
        async (targetTraces, otherTraces1, otherTraces2) => {
          ddbMock.reset();

          // retrieveContext queries by workspace_id via the GSI.
          // The mock should only return traces for the queried workspace.
          // This simulates DynamoDB's GSI behavior correctly.
          ddbMock.on(QueryCommand).callsFake((input) => {
            const wsId = input.ExpressionAttributeValues?.[':v'];
            if (wsId === 'ws-target') {
              return { Items: JSON.parse(JSON.stringify(targetTraces)) };
            }
            if (wsId === 'ws-other-1') {
              return { Items: JSON.parse(JSON.stringify(otherTraces1)) };
            }
            if (wsId === 'ws-other-2') {
              return { Items: JSON.parse(JSON.stringify(otherTraces2)) };
            }
            return { Items: [] };
          });

          const context = await retrieveContext('ws-target');

          // Context must NOT contain trace_ids from other workspaces
          for (const trace of [...otherTraces1, ...otherTraces2]) {
            expect(context).not.toContain(trace.trace_id);
          }

          // If target workspace has completed traces with fields, context should be non-empty
          const targetCompleted = targetTraces.filter(
            (t) => t.fields && t.fields.length > 0
          );
          if (targetCompleted.length > 0) {
            expect(context.length).toBeGreaterThan(0);

            // At least one target trace_id should appear
            const anyTargetPresent = targetCompleted.some((t) =>
              context.includes(t.trace_id)
            );
            expect(anyTargetPresent).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
