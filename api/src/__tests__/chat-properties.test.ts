import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { buildPrompt, truncateMemory } from '../handlers/chat';
import { ApiRequest, MemoryEntry, Session, Workspace } from '../models/types';
import { invokeModel } from '../lib/bedrock';

/**
 * Chat System — Property-Based Tests
 *
 * Property 6: Chat exchange appends exactly two memory entries
 * Property 7: Failed Bedrock call leaves memory unchanged
 * Property 10: Prompt construction includes all components in correct order
 */

// ── Mock Bedrock module ──

vi.mock('../lib/bedrock', () => ({
  invokeModel: vi.fn().mockResolvedValue({
    response: 'Mocked assistant response',
    inputTokens: 100,
    outputTokens: 20,
  }),
}));

// ── DynamoDB mock ──

const ddbMock = mockClient(DynamoDBDocumentClient);

// ── Arbitraries ──

/** Generate a single MemoryEntry */
const memoryEntryArb = (role: 'user' | 'assistant'): fc.Arbitrary<MemoryEntry> =>
  fc.string({ minLength: 1, maxLength: 200 }).map((content) => ({
    role,
    content,
    timestamp: new Date().toISOString(),
  }));

/** Generate a valid memory array (alternating user/assistant pairs) */
const memoryPairsArb = (minPairs = 0, maxPairs = 10): fc.Arbitrary<MemoryEntry[]> =>
  fc.integer({ min: minPairs, max: maxPairs }).chain((numPairs) => {
    if (numPairs === 0) return fc.constant([] as MemoryEntry[]);
    return fc.tuple(
      ...Array.from({ length: numPairs }, () =>
        fc.tuple(memoryEntryArb('user'), memoryEntryArb('assistant'))
      )
    ).map((pairs) => pairs.flat());
  });

/** Generate a non-empty, non-whitespace-only user message */
const userMessageArb = fc.string({ minLength: 1, maxLength: 300 })
  .filter((s) => s.trim().length > 0);

// ── Helper ──

const SESSIONS_TABLE = process.env.SESSIONS_TABLE ?? 'docops-sessions';
const WORKSPACES_TABLE = process.env.WORKSPACES_TABLE ?? 'docops-workspaces';

function makeReq(sessionId: string, message: string): ApiRequest {
  return {
    method: 'POST',
    path: `/v1/sessions/${sessionId}/chat`,
    pathParams: { id: sessionId },
    queryParams: {},
    body: { message },
    headers: {},
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      tenant: { tenant_id: 'tenant-1', email: 'test@test.com', plan: 'pro', created_at: '2024-01-01' },
    },
  };
}


// ═══════════════════════════════════════════════════════════════════
// Property 6: Chat exchange appends exactly two memory entries
// ═══════════════════════════════════════════════════════════════════

describe('Chat Exchange Property Tests', () => {
  beforeEach(() => {
    ddbMock.reset();
    // Ensure Bedrock mock returns success
    vi.mocked(invokeModel).mockResolvedValue({
      response: 'Mocked assistant response',
      inputTokens: 100,
      outputTokens: 20,
    });
  });

  /**
   * Property 6: Chat exchange appends exactly two memory entries
   *
   * For any successful chat message exchange, the session memory grows by
   * exactly two entries: one with role `user` and one with role `assistant`,
   * in that order, appended at the end.
   *
   * **Validates: Requirements 4.5**
   */
  it('Property 6: chat exchange appends exactly two memory entries', async () => {
    await fc.assert(
      fc.asyncProperty(
        memoryPairsArb(0, 8),
        userMessageArb,
        async (existingMemory, message) => {
          ddbMock.reset();

          const sessionId = 'sess-prop6';
          const workspaceId = 'ws-prop6';

          const session: Session = {
            session_id: sessionId,
            workspace_id: workspaceId,
            tenant_id: 'tenant-1',
            title: 'Test Session',
            memory: existingMemory,
            created_at: '2024-01-01T00:00:00Z',
          };

          const workspace: Workspace = {
            workspace_id: workspaceId,
            tenant_id: 'tenant-1',
            name: 'Test Workspace',
            prompt_version: 'v1',
            hitl_threshold: 0.8,
            created_at: '2024-01-01T00:00:00Z',
          };

          ddbMock.on(GetCommand).callsFake((input) => {
            if (input.TableName === SESSIONS_TABLE) {
              return { Item: JSON.parse(JSON.stringify(session)) };
            }
            if (input.TableName === WORKSPACES_TABLE) {
              return { Item: JSON.parse(JSON.stringify(workspace)) };
            }
            return { Item: undefined };
          });

          ddbMock.on(QueryCommand).resolves({ Items: [] });

          let capturedUpdate: Record<string, unknown> | null = null;
          ddbMock.on(UpdateCommand).callsFake((input) => {
            if (capturedUpdate === null) {
              capturedUpdate = input as Record<string, unknown>;
            }
            return { Attributes: {} };
          });

          const { handleChatMessage } = await import('../handlers/chat');
          const res = await handleChatMessage(makeReq(sessionId, message));

          expect(res.statusCode).toBe(200);
          expect(capturedUpdate).not.toBeNull();

          const exprValues = (capturedUpdate as any).ExpressionAttributeValues as Record<string, unknown>;
          const newEntries = exprValues[':newEntries'] as MemoryEntry[];

          expect(newEntries).toHaveLength(2);
          expect(newEntries[0].role).toBe('user');
          expect(newEntries[1].role).toBe('assistant');
          expect(newEntries[0].content).toBe(message);
          expect(newEntries[0].timestamp).toBeDefined();
          expect(newEntries[1].timestamp).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Property 10: Prompt construction includes all components in correct order
// ═══════════════════════════════════════════════════════════════════

describe('Prompt Construction Property Tests', () => {
  /**
   * Property 10: Prompt construction includes all components in correct order
   *
   * For any non-empty context, non-empty memory window, and user message,
   * the constructed prompt contains: a system string with the context embedded,
   * followed by messages array with memory entries first and the user message last.
   *
   * **Validates: Requirements 4.3**
   */
  it('Property 10: prompt includes all components in correct order', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        memoryPairsArb(1, 5),
        userMessageArb,
        (context, memory, userMessage) => {
          const result = buildPrompt(context, memory, userMessage);

          expect(result.system).toContain(context);
          expect(result.messages.length).toBeGreaterThan(0);

          const lastMsg = result.messages[result.messages.length - 1];
          expect(lastMsg.role).toBe('user');
          expect(lastMsg.content).toBe(userMessage);

          const truncated = truncateMemory(memory);
          const expectedMemoryCount = truncated.length;

          expect(result.messages.length).toBe(expectedMemoryCount + 1);

          for (let i = 0; i < expectedMemoryCount; i++) {
            expect(result.messages[i].role).toBe(truncated[i].role);
            expect(result.messages[i].content).toBe(truncated[i].content);
          }
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Property 7: Failed Bedrock call leaves memory unchanged
// ═══════════════════════════════════════════════════════════════════

describe('Failed Bedrock Call Property Tests', () => {
  beforeEach(() => {
    ddbMock.reset();
    // Set Bedrock mock to always reject for this describe block
    vi.mocked(invokeModel).mockImplementation(() =>
      Promise.reject(new Error('Bedrock error'))
    );
  });

  /**
   * Property 7: Failed Bedrock call leaves memory unchanged
   *
   * For any chat message where the Bedrock invocation fails, the session
   * memory array remains identical to its state before the request.
   * The handler returns 502 and does NOT call UpdateCommand.
   *
   * **Validates: Requirements 4.10**
   */
  it('Property 7: failed Bedrock call leaves memory unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        memoryPairsArb(0, 8),
        userMessageArb,
        async (existingMemory, message) => {
          ddbMock.reset();

          const sessionId = 'sess-prop7';
          const workspaceId = 'ws-prop7';

          const session: Session = {
            session_id: sessionId,
            workspace_id: workspaceId,
            tenant_id: 'tenant-1',
            title: 'Test Session',
            memory: existingMemory,
            created_at: '2024-01-01T00:00:00Z',
          };

          const workspace: Workspace = {
            workspace_id: workspaceId,
            tenant_id: 'tenant-1',
            name: 'Test Workspace',
            prompt_version: 'v1',
            hitl_threshold: 0.8,
            created_at: '2024-01-01T00:00:00Z',
          };

          ddbMock.on(GetCommand).callsFake((input) => {
            if (input.TableName === SESSIONS_TABLE) {
              return { Item: JSON.parse(JSON.stringify(session)) };
            }
            if (input.TableName === WORKSPACES_TABLE) {
              return { Item: JSON.parse(JSON.stringify(workspace)) };
            }
            return { Item: undefined };
          });

          ddbMock.on(QueryCommand).resolves({ Items: [] });

          let updateCalled = false;
          ddbMock.on(UpdateCommand).callsFake(() => {
            updateCalled = true;
            return { Attributes: {} };
          });

          const { handleChatMessage } = await import('../handlers/chat');
          const res = await handleChatMessage(makeReq(sessionId, message));

          // Should return 502
          expect(res.statusCode).toBe(502);

          // UpdateCommand should NOT have been called (memory unchanged)
          expect(updateCalled).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
