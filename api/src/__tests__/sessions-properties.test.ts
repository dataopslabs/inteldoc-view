import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { handleListSessions } from '../handlers/sessions';
import { ApiRequest, MemoryEntry, Session, Workspace } from '../models/types';

/**
 * Session System — Property-Based Tests
 *
 * Property 8: Session list excludes full memory contents
 */

const ddbMock = mockClient(DynamoDBDocumentClient);

const WORKSPACES_TABLE = process.env.WORKSPACES_TABLE ?? 'docops-workspaces';

beforeEach(() => {
  ddbMock.reset();
});

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

/** Generate a session with random memory size */
const sessionArb = (workspaceId: string): fc.Arbitrary<Session> =>
  fc.tuple(fc.uuid(), memoryPairsArb(0, 15)).map(([id, memory]) => ({
    session_id: id,
    workspace_id: workspaceId,
    tenant_id: 'tenant-1',
    title: 'Test Session',
    memory,
    created_at: new Date().toISOString(),
  }));

// ── Helper ──

function makeListReq(workspaceId: string): ApiRequest {
  return {
    method: 'GET',
    path: `/v1/workspaces/${workspaceId}/sessions`,
    pathParams: { id: workspaceId },
    queryParams: {},
    body: undefined,
    headers: {},
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      tenant: { tenant_id: 'tenant-1', email: 'test@test.com', plan: 'pro', created_at: '2024-01-01' },
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Property 8: Session list excludes full memory contents
// ═══════════════════════════════════════════════════════════════════

describe('Session List Property Tests', () => {
  /**
   * Property 8: Session list excludes full memory contents
   *
   * For any list sessions response, each session object in the array
   * contains `message_count` (a number) but does not contain the `memory` array.
   *
   * **Validates: Requirements 2.5**
   */
  it('Property 8: session list excludes full memory contents', () => {
    fc.assert(
      fc.asyncProperty(
        fc.array(sessionArb('ws-prop8'), { minLength: 1, maxLength: 10 }),
        async (sessions) => {
          ddbMock.reset();

          const workspaceId = 'ws-prop8';

          const workspace: Workspace = {
            workspace_id: workspaceId,
            tenant_id: 'tenant-1',
            name: 'Test Workspace',
            prompt_version: 'v1',
            hitl_threshold: 0.8,
            created_at: '2024-01-01T00:00:00Z',
          };

          // Mock GetCommand for workspace ownership check
          ddbMock.on(GetCommand).callsFake((input) => {
            if (input.TableName === WORKSPACES_TABLE) {
              return { Item: JSON.parse(JSON.stringify(workspace)) };
            }
            return { Item: undefined };
          });

          // Mock QueryCommand to return sessions with varying memory arrays
          ddbMock.on(QueryCommand).resolves({
            Items: sessions.map((s) => JSON.parse(JSON.stringify(s))),
          });

          const res = await handleListSessions(makeListReq(workspaceId));

          expect(res.statusCode).toBe(200);

          const body = res.body as { sessions: Record<string, unknown>[]; count: number };
          expect(body.sessions.length).toBe(sessions.length);

          for (let i = 0; i < body.sessions.length; i++) {
            const summary = body.sessions[i];

            // Must have message_count as a number
            expect(typeof summary.message_count).toBe('number');

            // Must NOT have memory key
            expect(summary).not.toHaveProperty('memory');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
