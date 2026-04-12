import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  truncateMemory,
  estimateTokens,
  MEMORY_TOKEN_BUDGET,
  MIN_RECENT_EXCHANGES,
  retrieveContext,
} from '../handlers/chat';
import { MemoryEntry } from '../models/types';

/**
 * Chat Memory System — Unit Tests
 *
 * Example-based tests for memory truncation and context retrieval.
 * Covers specific edge cases complementing the property-based tests
 * in chat-memory-properties.test.ts.
 *
 * Requirements: 5.1–5.5, 6.1–6.4
 */

const ddbMock = mockClient(DynamoDBDocumentClient);

// ── Helpers ──

const MIN_MESSAGES = MIN_RECENT_EXCHANGES * 2; // 4

function makeEntry(role: 'user' | 'assistant', content: string): MemoryEntry {
  return { role, content, timestamp: new Date().toISOString() };
}

/** Build a memory array of alternating user/assistant pairs */
function buildMemory(pairs: number, contentLength = 10): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  for (let i = 0; i < pairs; i++) {
    entries.push(makeEntry('user', 'u'.repeat(contentLength)));
    entries.push(makeEntry('assistant', 'a'.repeat(contentLength)));
  }
  return entries;
}

// ═══════════════════════════════════════════════════════════════════
// Memory truncation unit tests
// Requirements: 6.1–6.4
// ═══════════════════════════════════════════════════════════════════

describe('truncateMemory — unit tests', () => {
  it('memory at exactly minimum size (4 entries): no truncation', () => {
    const memory = buildMemory(2, 10); // 4 entries, small content
    expect(memory).toHaveLength(MIN_MESSAGES);

    const result = truncateMemory(memory);

    expect(result).toHaveLength(MIN_MESSAGES);
    // Content should be identical — no entries removed
    for (let i = 0; i < memory.length; i++) {
      expect(result[i].content).toBe(memory[i].content);
      expect(result[i].role).toBe(memory[i].role);
    }
  });

  it('memory with one very long message exceeding budget: truncated to minimum window', () => {
    // Create a memory with a very long message that far exceeds the budget
    // MEMORY_TOKEN_BUDGET = 4000 tokens, so we need content > 16000 chars (4000 * 4)
    const longContent = 'x'.repeat(20000); // 5000 tokens for this single entry
    const memory: MemoryEntry[] = [
      makeEntry('user', 'old question'),
      makeEntry('assistant', 'old answer'),
      makeEntry('user', 'another question'),
      makeEntry('assistant', 'another answer'),
      makeEntry('user', longContent),
      makeEntry('assistant', 'short reply'),
    ];

    const result = truncateMemory(memory);

    // Should be truncated to minimum window (4 entries) since even the
    // minimum window exceeds budget due to the long message
    expect(result).toHaveLength(MIN_MESSAGES);
    // The result should be the last 4 entries (contiguous suffix)
    expect(result[0].content).toBe('another question');
    expect(result[1].content).toBe('another answer');
    expect(result[2].content).toBe(longContent);
    expect(result[3].content).toBe('short reply');
  });

  it('memory within budget is not truncated', () => {
    // 6 entries with small content — well within 4000 token budget
    const memory = buildMemory(3, 20); // 6 entries, ~5 tokens each = ~30 tokens total
    expect(memory).toHaveLength(6);

    const result = truncateMemory(memory);

    expect(result).toHaveLength(6);
    for (let i = 0; i < memory.length; i++) {
      expect(result[i].content).toBe(memory[i].content);
    }
  });

  it('memory exceeding budget is trimmed to fit, preserving newest entries', () => {
    // Each entry ~500 tokens (2000 chars). 10 entries = ~5000 tokens > 4000 budget
    const memory = buildMemory(5, 2000);
    expect(memory).toHaveLength(10);

    const result = truncateMemory(memory);

    // Result should be a suffix of the original
    const offset = memory.length - result.length;
    expect(offset).toBeGreaterThan(0);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].content).toBe(memory[offset + i].content);
    }

    // Either within budget or at minimum size
    const tokens = estimateTokens(result);
    expect(tokens <= MEMORY_TOKEN_BUDGET || result.length === MIN_MESSAGES).toBe(true);
  });

  it('empty memory returns empty array', () => {
    const result = truncateMemory([]);
    expect(result).toHaveLength(0);
  });

  it('memory with fewer than minimum entries is returned as-is', () => {
    const memory = buildMemory(1, 10); // 2 entries
    const result = truncateMemory(memory);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe(memory[0].content);
    expect(result[1].content).toBe(memory[1].content);
  });
});

// ═══════════════════════════════════════════════════════════════════
// estimateTokens unit tests
// Requirements: 6.4
// ═══════════════════════════════════════════════════════════════════

describe('estimateTokens — unit tests', () => {
  it('returns 0 for empty array', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('estimates tokens as ceil(content.length / 4) per entry', () => {
    const entries: MemoryEntry[] = [
      makeEntry('user', 'Hello'),       // ceil(5/4) = 2
      makeEntry('assistant', 'Hi there'), // ceil(8/4) = 2
    ];
    expect(estimateTokens(entries)).toBe(4);
  });

  it('handles single character content', () => {
    const entries: MemoryEntry[] = [makeEntry('user', 'a')]; // ceil(1/4) = 1
    expect(estimateTokens(entries)).toBe(1);
  });

  it('handles content exactly divisible by 4', () => {
    const entries: MemoryEntry[] = [makeEntry('user', 'abcd')]; // ceil(4/4) = 1
    expect(estimateTokens(entries)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Context retrieval unit tests
// Requirements: 5.1–5.5
// ═══════════════════════════════════════════════════════════════════

describe('retrieveContext — unit tests', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('context with mix of completed/pending/failed traces: only completed included', async () => {
    const traces = [
      {
        trace_id: 'trace-completed-1',
        workspace_id: 'ws-1',
        status: 'completed',
        filename: 'invoice.pdf',
        fields: [{ field_name: 'total', value: '$500' }],
        created_at: '2024-01-03T00:00:00Z',
      },
      {
        trace_id: 'trace-pending',
        workspace_id: 'ws-1',
        status: 'pending',
        filename: 'report.pdf',
        fields: [{ field_name: 'title', value: 'Q4 Report' }],
        created_at: '2024-01-02T00:00:00Z',
      },
      {
        trace_id: 'trace-failed',
        workspace_id: 'ws-1',
        status: 'failed',
        filename: 'broken.pdf',
        fields: [{ field_name: 'error', value: 'parse failure' }],
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        trace_id: 'trace-completed-2',
        workspace_id: 'ws-1',
        status: 'completed',
        filename: 'receipt.pdf',
        fields: [{ field_name: 'amount', value: '$100' }],
        created_at: '2024-01-04T00:00:00Z',
      },
    ];

    ddbMock.on(QueryCommand).resolves({ Items: traces });

    const context = await retrieveContext('ws-1');

    // Completed traces should be present
    expect(context).toContain('trace-completed-1');
    expect(context).toContain('trace-completed-2');
    expect(context).toContain('invoice.pdf');
    expect(context).toContain('receipt.pdf');
    expect(context).toContain('$500');
    expect(context).toContain('$100');

    // Non-completed traces should NOT be present
    expect(context).not.toContain('trace-pending');
    expect(context).not.toContain('trace-failed');
    expect(context).not.toContain('Q4 Report');
    expect(context).not.toContain('parse failure');
  });

  it('context with no completed traces: returns empty string', async () => {
    const traces = [
      {
        trace_id: 'trace-pending',
        workspace_id: 'ws-1',
        status: 'pending',
        filename: 'doc.pdf',
        fields: [{ field_name: 'title', value: 'Draft' }],
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        trace_id: 'trace-failed',
        workspace_id: 'ws-1',
        status: 'failed',
        filename: 'bad.pdf',
        fields: [{ field_name: 'error', value: 'timeout' }],
        created_at: '2024-01-02T00:00:00Z',
      },
    ];

    ddbMock.on(QueryCommand).resolves({ Items: traces });

    const context = await retrieveContext('ws-1');
    expect(context).toBe('');
  });

  it('context with no traces at all: returns empty string', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    const context = await retrieveContext('ws-1');
    expect(context).toBe('');
  });

  it('context truncation removes oldest traces first', async () => {
    // Create traces with large fields so they exceed the 4000 token budget
    // Each trace block will be ~2500 chars = ~625 tokens
    const bigFieldValue = 'v'.repeat(2400);
    const traces = [
      {
        trace_id: 'trace-oldest',
        workspace_id: 'ws-1',
        status: 'completed',
        filename: 'oldest.pdf',
        fields: [{ field_name: 'data', value: bigFieldValue }],
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        trace_id: 'trace-middle',
        workspace_id: 'ws-1',
        status: 'completed',
        filename: 'middle.pdf',
        fields: [{ field_name: 'data', value: bigFieldValue }],
        created_at: '2024-01-02T00:00:00Z',
      },
      {
        trace_id: 'trace-newest-1',
        workspace_id: 'ws-1',
        status: 'completed',
        filename: 'newest1.pdf',
        fields: [{ field_name: 'data', value: bigFieldValue }],
        created_at: '2024-01-03T00:00:00Z',
      },
      {
        trace_id: 'trace-newest-2',
        workspace_id: 'ws-1',
        status: 'completed',
        filename: 'newest2.pdf',
        fields: [{ field_name: 'data', value: bigFieldValue }],
        created_at: '2024-01-04T00:00:00Z',
      },
      {
        trace_id: 'trace-newest-3',
        workspace_id: 'ws-1',
        status: 'completed',
        filename: 'newest3.pdf',
        fields: [{ field_name: 'data', value: bigFieldValue }],
        created_at: '2024-01-05T00:00:00Z',
      },
      {
        trace_id: 'trace-newest-4',
        workspace_id: 'ws-1',
        status: 'completed',
        filename: 'newest4.pdf',
        fields: [{ field_name: 'data', value: bigFieldValue }],
        created_at: '2024-01-06T00:00:00Z',
      },
      {
        trace_id: 'trace-newest-5',
        workspace_id: 'ws-1',
        status: 'completed',
        filename: 'newest5.pdf',
        fields: [{ field_name: 'data', value: bigFieldValue }],
        created_at: '2024-01-07T00:00:00Z',
      },
    ];

    ddbMock.on(QueryCommand).resolves({ Items: traces });

    const context = await retrieveContext('ws-1');

    // The newest traces should be included (sorted newest first, added until budget hit)
    expect(context).toContain('trace-newest-5');
    expect(context).toContain('trace-newest-4');

    // The oldest trace should be dropped due to budget constraints
    expect(context).not.toContain('trace-oldest');

    // Verify total context is within budget
    const estimatedTokens = Math.ceil(context.length / 4);
    expect(estimatedTokens).toBeLessThanOrEqual(4000);
  });

  it('completed traces with empty fields are excluded', async () => {
    const traces = [
      {
        trace_id: 'trace-no-fields',
        workspace_id: 'ws-1',
        status: 'completed',
        filename: 'empty.pdf',
        fields: [],
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        trace_id: 'trace-with-fields',
        workspace_id: 'ws-1',
        status: 'completed',
        filename: 'full.pdf',
        fields: [{ field_name: 'title', value: 'Report' }],
        created_at: '2024-01-02T00:00:00Z',
      },
    ];

    ddbMock.on(QueryCommand).resolves({ Items: traces });

    const context = await retrieveContext('ws-1');

    expect(context).toContain('trace-with-fields');
    expect(context).not.toContain('trace-no-fields');
  });
});
