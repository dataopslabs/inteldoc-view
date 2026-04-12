import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApiRequest, MemoryEntry, Session, Workspace } from '../models/types';

/**
 * Chat Handler — Unit Tests
 *
 * Tests for handleChatMessage covering:
 * - Successful chat message with response and memory append
 * - 400 on missing/empty message
 * - 404 on missing session
 * - 403 on wrong tenant
 * - 502 on Bedrock failure, memory unchanged
 * - Chat with empty workspace (no traces)
 * - Chat with zero memory (first exchange)
 * - Multi-turn: 3 messages, memory grows correctly
 *
 * Requirements: 4.1–4.10, 5.4, 8.1–8.3
 */

// ── Mock Bedrock module ──

vi.mock('../lib/bedrock', () => ({
  invokeModel: vi.fn().mockResolvedValue({
    response: 'Mocked assistant response',
    inputTokens: 150,
    outputTokens: 30,
  }),
}));

import { handleChatMessage } from '../handlers/chat';
import { invokeModel } from '../lib/bedrock';

// ── DynamoDB mock ──

const ddbMock = mockClient(DynamoDBDocumentClient);

// ── Constants ──

const SESSIONS_TABLE = process.env.SESSIONS_TABLE ?? 'docops-sessions';
const WORKSPACES_TABLE = process.env.WORKSPACES_TABLE ?? 'docops-workspaces';
const TRACES_TABLE = process.env.TRACES_TABLE ?? 'docops-traces';

// ── Fixtures ──

const sampleWorkspace: Workspace = {
  workspace_id: 'ws-1',
  tenant_id: 'tenant-1',
  name: 'Test Workspace',
  prompt_version: 'v1',
  hitl_threshold: 0.8,
  created_at: '2024-01-01T00:00:00Z',
};

const sampleSession: Session = {
  session_id: 'sess-1',
  workspace_id: 'ws-1',
  tenant_id: 'tenant-1',
  title: 'Test Chat',
  memory: [
    { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:01:00Z' },
    { role: 'assistant', content: 'Hi there!', timestamp: '2024-01-01T00:01:01Z' },
  ],
  created_at: '2024-01-01T00:00:00Z',
};

const sampleTraces = [
  {
    trace_id: 'trace-1',
    workspace_id: 'ws-1',
    status: 'completed',
    filename: 'invoice.pdf',
    fields: [
      { field_name: 'total', value: '$1,250.00' },
      { field_name: 'date', value: '2024-01-15' },
    ],
    created_at: '2024-01-01T00:00:00Z',
  },
];

// ── Helper ──

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'POST',
    path: '/v1/sessions/sess-1/chat',
    pathParams: { id: 'sess-1' },
    queryParams: {},
    body: { message: 'What is the invoice total?' },
    headers: {},
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      tenant: { tenant_id: 'tenant-1', email: 'test@test.com', plan: 'pro', created_at: '2024-01-01' },
    },
    ...overrides,
  };
}


/** Set up standard DynamoDB mocks for a successful chat flow */
function setupSuccessMocks(session: Session = sampleSession, traces = sampleTraces) {
  ddbMock.on(GetCommand).callsFake((input) => {
    if (input.TableName === SESSIONS_TABLE) {
      return { Item: JSON.parse(JSON.stringify(session)) };
    }
    if (input.TableName === WORKSPACES_TABLE) {
      return { Item: JSON.parse(JSON.stringify(sampleWorkspace)) };
    }
    return { Item: undefined };
  });

  ddbMock.on(QueryCommand).resolves({ Items: traces });
  ddbMock.on(UpdateCommand).resolves({ Attributes: {} });
}

// ═══════════════════════════════════════════════════════════════════
// Successful chat message
// ═══════════════════════════════════════════════════════════════════

describe('handleChatMessage — success', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.mocked(invokeModel).mockResolvedValue({
      response: 'The invoice total is $1,250.00.',
      inputTokens: 150,
      outputTokens: 30,
    });
  });

  it('returns 200 with response, message_count, and tokens', async () => {
    setupSuccessMocks();

    const res = await handleChatMessage(makeReq());

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.response).toBe('The invoice total is $1,250.00.');
    expect(body.message_count).toBe(4); // 2 existing + 2 new
    expect(body.tokens).toEqual({ input: 150, output: 30 });
  });

  it('appends exactly 2 memory entries (user + assistant) via UpdateCommand', async () => {
    setupSuccessMocks();

    let capturedUpdate: Record<string, unknown> | null = null;
    ddbMock.on(UpdateCommand).callsFake((input) => {
      // Only capture the first UpdateCommand (memory append to sessions table)
      if (capturedUpdate === null) {
        capturedUpdate = input as Record<string, unknown>;
      }
      return { Attributes: {} };
    });

    await handleChatMessage(makeReq());

    expect(capturedUpdate).not.toBeNull();
    const exprValues = (capturedUpdate as any).ExpressionAttributeValues as Record<string, unknown>;
    const newEntries = exprValues[':newEntries'] as MemoryEntry[];

    expect(newEntries).toHaveLength(2);
    expect(newEntries[0].role).toBe('user');
    expect(newEntries[0].content).toBe('What is the invoice total?');
    expect(newEntries[1].role).toBe('assistant');
    expect(newEntries[1].content).toBe('The invoice total is $1,250.00.');
    expect(newEntries[0].timestamp).toBeDefined();
    expect(newEntries[1].timestamp).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 400 on missing/empty message
// ═══════════════════════════════════════════════════════════════════

describe('handleChatMessage — 400 validation', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('returns 400 when message field is missing', async () => {
    const res = await handleChatMessage(makeReq({ body: {} }));
    expect(res.statusCode).toBe(400);
    expect((res.body as any).error).toContain('message');
  });

  it('returns 400 when message is empty string', async () => {
    const res = await handleChatMessage(makeReq({ body: { message: '' } }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when message is whitespace only', async () => {
    const res = await handleChatMessage(makeReq({ body: { message: '   ' } }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when body is null', async () => {
    const res = await handleChatMessage(makeReq({ body: null }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when message is not a string', async () => {
    const res = await handleChatMessage(makeReq({ body: { message: 123 } }));
    expect(res.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 404 on missing session
// ═══════════════════════════════════════════════════════════════════

describe('handleChatMessage — 404 missing session', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('returns 404 when session does not exist', async () => {
    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === SESSIONS_TABLE) {
        return { Item: undefined };
      }
      return { Item: undefined };
    });

    const res = await handleChatMessage(makeReq({ pathParams: { id: 'sess-missing' } }));
    expect(res.statusCode).toBe(404);
    expect((res.body as any).error).toContain('Session not found');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 403 on wrong tenant
// ═══════════════════════════════════════════════════════════════════

describe('handleChatMessage — 403 wrong tenant', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('returns 403 when workspace belongs to different tenant', async () => {
    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === SESSIONS_TABLE) {
        return { Item: JSON.parse(JSON.stringify(sampleSession)) };
      }
      if (input.TableName === WORKSPACES_TABLE) {
        return { Item: { ...sampleWorkspace, tenant_id: 'other-tenant' } };
      }
      return { Item: undefined };
    });

    const res = await handleChatMessage(makeReq());
    expect(res.statusCode).toBe(403);
    expect((res.body as any).error).toContain('Forbidden');
  });
});


// ═══════════════════════════════════════════════════════════════════
// 502 on Bedrock failure, memory unchanged
// ═══════════════════════════════════════════════════════════════════

describe('handleChatMessage — 502 Bedrock failure', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.mocked(invokeModel).mockRejectedValue(new Error('Bedrock service error'));
  });

  it('returns 502 when Bedrock invocation fails', async () => {
    setupSuccessMocks();

    const res = await handleChatMessage(makeReq());
    expect(res.statusCode).toBe(502);
    expect((res.body as any).error).toContain('Failed to generate response');
  });

  it('does NOT call UpdateCommand when Bedrock fails (memory unchanged)', async () => {
    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === SESSIONS_TABLE) {
        return { Item: JSON.parse(JSON.stringify(sampleSession)) };
      }
      if (input.TableName === WORKSPACES_TABLE) {
        return { Item: JSON.parse(JSON.stringify(sampleWorkspace)) };
      }
      return { Item: undefined };
    });
    ddbMock.on(QueryCommand).resolves({ Items: sampleTraces });

    let updateCalled = false;
    ddbMock.on(UpdateCommand).callsFake(() => {
      updateCalled = true;
      return { Attributes: {} };
    });

    await handleChatMessage(makeReq());
    expect(updateCalled).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Chat with empty workspace (no traces)
// ═══════════════════════════════════════════════════════════════════

describe('handleChatMessage — empty workspace (no traces)', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.mocked(invokeModel).mockClear();
    vi.mocked(invokeModel).mockResolvedValue({
      response: 'No documents have been processed yet.',
      inputTokens: 80,
      outputTokens: 15,
    });
  });

  it('system prompt tells user to process documents when workspace has no traces', async () => {
    const emptyMemorySession: Session = {
      ...sampleSession,
      memory: [],
    };

    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === SESSIONS_TABLE) {
        return { Item: JSON.parse(JSON.stringify(emptyMemorySession)) };
      }
      if (input.TableName === WORKSPACES_TABLE) {
        return { Item: JSON.parse(JSON.stringify(sampleWorkspace)) };
      }
      return { Item: undefined };
    });

    // Empty traces — no completed documents
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(UpdateCommand).resolves({ Attributes: {} });

    const res = await handleChatMessage(makeReq());
    expect(res.statusCode).toBe(200);

    // Verify invokeModel was called with a system prompt mentioning processing documents
    expect(vi.mocked(invokeModel)).toHaveBeenCalledOnce();
    const invokeCall = vi.mocked(invokeModel).mock.calls[0];
    const systemPrompt = invokeCall[0];
    expect(systemPrompt).toContain('process documents');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Chat with zero memory (first exchange)
// ═══════════════════════════════════════════════════════════════════

describe('handleChatMessage — zero memory (first exchange)', () => {
  beforeEach(() => {
    ddbMock.reset();
    vi.mocked(invokeModel).mockResolvedValue({
      response: 'The invoice total is $1,250.00.',
      inputTokens: 120,
      outputTokens: 25,
    });
  });

  it('works correctly on first message with empty memory', async () => {
    const freshSession: Session = {
      ...sampleSession,
      memory: [],
    };

    setupSuccessMocks(freshSession);

    const res = await handleChatMessage(makeReq());

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.response).toBe('The invoice total is $1,250.00.');
    expect(body.message_count).toBe(2); // 0 existing + 2 new
  });

  it('appends user and assistant entries on first exchange', async () => {
    const freshSession: Session = {
      ...sampleSession,
      memory: [],
    };

    ddbMock.on(GetCommand).callsFake((input) => {
      if (input.TableName === SESSIONS_TABLE) {
        return { Item: JSON.parse(JSON.stringify(freshSession)) };
      }
      if (input.TableName === WORKSPACES_TABLE) {
        return { Item: JSON.parse(JSON.stringify(sampleWorkspace)) };
      }
      return { Item: undefined };
    });
    ddbMock.on(QueryCommand).resolves({ Items: sampleTraces });

    let capturedUpdate: Record<string, unknown> | null = null;
    ddbMock.on(UpdateCommand).callsFake((input) => {
      if (capturedUpdate === null) {
        capturedUpdate = input as Record<string, unknown>;
      }
      return { Attributes: {} };
    });

    await handleChatMessage(makeReq());

    expect(capturedUpdate).not.toBeNull();
    const exprValues = (capturedUpdate as any).ExpressionAttributeValues as Record<string, unknown>;
    const newEntries = exprValues[':newEntries'] as MemoryEntry[];
    expect(newEntries).toHaveLength(2);
    expect(newEntries[0].role).toBe('user');
    expect(newEntries[1].role).toBe('assistant');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Multi-turn: send 3 messages, verify memory grows correctly
// ═══════════════════════════════════════════════════════════════════

describe('handleChatMessage — multi-turn conversation', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('memory grows correctly across 3 sequential messages', async () => {
    let currentMemory: MemoryEntry[] = [];
    const messages = [
      'What is the invoice total?',
      'When was it issued?',
      'Who is the vendor?',
    ];
    const responses = [
      'The total is $1,250.00.',
      'It was issued on January 15, 2024.',
      'The vendor is Acme Corp.',
    ];

    for (let turn = 0; turn < 3; turn++) {
      ddbMock.reset();

      vi.mocked(invokeModel).mockResolvedValue({
        response: responses[turn],
        inputTokens: 100 + turn * 50,
        outputTokens: 20 + turn * 5,
      });

      const sessionForTurn: Session = {
        ...sampleSession,
        memory: [...currentMemory],
      };

      ddbMock.on(GetCommand).callsFake((input) => {
        if (input.TableName === SESSIONS_TABLE) {
          return { Item: JSON.parse(JSON.stringify(sessionForTurn)) };
        }
        if (input.TableName === WORKSPACES_TABLE) {
          return { Item: JSON.parse(JSON.stringify(sampleWorkspace)) };
        }
        return { Item: undefined };
      });
      ddbMock.on(QueryCommand).resolves({ Items: sampleTraces });

      let capturedEntries: MemoryEntry[] = [];
      let firstUpdateCaptured = false;
      ddbMock.on(UpdateCommand).callsFake((input) => {
        if (!firstUpdateCaptured) {
          const exprValues = (input as any).ExpressionAttributeValues as Record<string, unknown>;
          capturedEntries = exprValues[':newEntries'] as MemoryEntry[];
          firstUpdateCaptured = true;
        }
        return { Attributes: {} };
      });

      const res = await handleChatMessage(makeReq({
        body: { message: messages[turn] },
      }));

      expect(res.statusCode).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.response).toBe(responses[turn]);

      // message_count = existing memory + 2 new entries
      const expectedCount = currentMemory.length + 2;
      expect(body.message_count).toBe(expectedCount);

      // Verify appended entries
      expect(capturedEntries).toHaveLength(2);
      expect(capturedEntries[0].role).toBe('user');
      expect(capturedEntries[0].content).toBe(messages[turn]);
      expect(capturedEntries[1].role).toBe('assistant');
      expect(capturedEntries[1].content).toBe(responses[turn]);

      // Simulate DynamoDB list_append by growing currentMemory
      currentMemory = [...currentMemory, ...capturedEntries];
    }

    // After 3 turns, memory should have 6 entries (3 user + 3 assistant)
    expect(currentMemory).toHaveLength(6);
    expect(currentMemory[0].role).toBe('user');
    expect(currentMemory[1].role).toBe('assistant');
    expect(currentMemory[2].role).toBe('user');
    expect(currentMemory[3].role).toBe('assistant');
    expect(currentMemory[4].role).toBe('user');
    expect(currentMemory[5].role).toBe('assistant');
  });
});
