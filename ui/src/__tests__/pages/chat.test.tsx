/**
 * Page integration tests for Chat page.
 *
 * Extracts pure logic from chat/page.tsx and tests:
 * - Message display mapping (memory → DisplayMessage)
 * - Optimistic update state transitions
 * - Session management (creation, sorting, deletion)
 * - Session list sorting by created_at descending
 *
 * Requirements: 8.1–8.10
 */
import { describe, it, expect } from 'vitest';

// --- Types mirroring chat/page.tsx ---

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

interface SessionSummary {
  session_id: string;
  workspace_id: string;
  title: string;
  message_count: number;
  created_at: string;
}

// --- Extracted logic from chat/page.tsx ---

/** Mirrors the memory → DisplayMessage mapping in selectSession */
function mapMemoryToDisplay(memory: MemoryEntry[]): DisplayMessage[] {
  return memory.map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
  }));
}

/** Mirrors the optimistic send: append user message, clear input */
function applyOptimisticSend(
  messages: DisplayMessage[],
  userText: string
): { messages: DisplayMessage[]; clearedInput: string } {
  const userDisplay: DisplayMessage = {
    role: 'user',
    content: userText,
    timestamp: new Date().toISOString(),
  };
  return {
    messages: [...messages, userDisplay],
    clearedInput: '',
  };
}

/** Mirrors the success path: append assistant message */
function applyServerResponse(
  messages: DisplayMessage[],
  response: string,
  tokens: { input: number; output: number }
): DisplayMessage[] {
  const assistantDisplay: DisplayMessage = {
    role: 'assistant',
    content: response,
    timestamp: new Date().toISOString(),
    tokens,
  };
  return [...messages, assistantDisplay];
}

/** Mirrors the error path: append error, restore input */
function applyServerError(
  messages: DisplayMessage[],
  errorMsg: string
): DisplayMessage[] {
  const errorDisplay: DisplayMessage = {
    role: 'error',
    content: errorMsg,
    timestamp: new Date().toISOString(),
  };
  return [...messages, errorDisplay];
}

/** Mirrors session sorting in fetchSessions */
function sortSessionsByDate(sessions: SessionSummary[]): SessionSummary[] {
  return [...sessions].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/** Mirrors session deletion: filter out by ID */
function deleteSession(sessions: SessionSummary[], sessionId: string): SessionSummary[] {
  return sessions.filter((s) => s.session_id !== sessionId);
}

function truncateId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) + '…' : id;
}

// --- Tests ---

describe('Chat page logic', () => {
  describe('message display mapping (Req 8.3, 8.4)', () => {
    it('maps memory entries to display messages preserving order', () => {
      const memory: MemoryEntry[] = [
        { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Hi there!', timestamp: '2024-01-01T00:00:01Z' },
        { role: 'user', content: 'How are you?', timestamp: '2024-01-01T00:00:02Z' },
      ];
      const display = mapMemoryToDisplay(memory);
      expect(display).toHaveLength(3);
      expect(display[0].role).toBe('user');
      expect(display[0].content).toBe('Hello');
      expect(display[1].role).toBe('assistant');
      expect(display[1].content).toBe('Hi there!');
      expect(display[2].role).toBe('user');
      expect(display[2].content).toBe('How are you?');
    });

    it('handles empty memory', () => {
      expect(mapMemoryToDisplay([])).toEqual([]);
    });

    it('preserves timestamps', () => {
      const memory: MemoryEntry[] = [
        { role: 'user', content: 'test', timestamp: '2024-06-15T10:30:00Z' },
      ];
      const display = mapMemoryToDisplay(memory);
      expect(display[0].timestamp).toBe('2024-06-15T10:30:00Z');
    });
  });

  describe('optimistic update state transitions (Req 8.5, 8.8)', () => {
    it('appends user message and clears input on send', () => {
      const existing: DisplayMessage[] = [
        { role: 'user', content: 'Hi', timestamp: '2024-01-01T00:00:00Z' },
      ];
      const result = applyOptimisticSend(existing, 'New message');
      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toBe('New message');
      expect(result.clearedInput).toBe('');
    });

    it('appends assistant message on server success', () => {
      const messages: DisplayMessage[] = [
        { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      ];
      const result = applyServerResponse(messages, 'Response text', { input: 10, output: 20 });
      expect(result).toHaveLength(2);
      expect(result[1].role).toBe('assistant');
      expect(result[1].content).toBe('Response text');
      expect(result[1].tokens).toEqual({ input: 10, output: 20 });
    });

    it('appends error message on server failure', () => {
      const messages: DisplayMessage[] = [
        { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z' },
      ];
      const result = applyServerError(messages, 'Network error');
      expect(result).toHaveLength(2);
      expect(result[1].role).toBe('error');
      expect(result[1].content).toBe('Network error');
    });

    it('preserves existing messages through send lifecycle', () => {
      const existing: DisplayMessage[] = [
        { role: 'user', content: 'First', timestamp: '2024-01-01T00:00:00Z' },
        { role: 'assistant', content: 'Reply', timestamp: '2024-01-01T00:00:01Z' },
      ];
      const afterSend = applyOptimisticSend(existing, 'Second');
      expect(afterSend.messages[0]).toEqual(existing[0]);
      expect(afterSend.messages[1]).toEqual(existing[1]);

      const afterResponse = applyServerResponse(afterSend.messages, 'Reply 2', { input: 5, output: 10 });
      expect(afterResponse[0]).toEqual(existing[0]);
      expect(afterResponse[1]).toEqual(existing[1]);
    });
  });

  describe('session management (Req 8.1, 8.2)', () => {
    it('sorts sessions by created_at descending', () => {
      const sessions: SessionSummary[] = [
        { session_id: 's1', workspace_id: 'ws1', title: 'Old', message_count: 1, created_at: '2024-01-01T00:00:00Z' },
        { session_id: 's3', workspace_id: 'ws1', title: 'New', message_count: 3, created_at: '2024-03-01T00:00:00Z' },
        { session_id: 's2', workspace_id: 'ws1', title: 'Mid', message_count: 2, created_at: '2024-02-01T00:00:00Z' },
      ];
      const sorted = sortSessionsByDate(sessions);
      expect(sorted[0].session_id).toBe('s3');
      expect(sorted[1].session_id).toBe('s2');
      expect(sorted[2].session_id).toBe('s1');
    });

    it('deletes a session by ID', () => {
      const sessions: SessionSummary[] = [
        { session_id: 's1', workspace_id: 'ws1', title: 'A', message_count: 1, created_at: '2024-01-01T00:00:00Z' },
        { session_id: 's2', workspace_id: 'ws1', title: 'B', message_count: 2, created_at: '2024-02-01T00:00:00Z' },
        { session_id: 's3', workspace_id: 'ws1', title: 'C', message_count: 3, created_at: '2024-03-01T00:00:00Z' },
      ];
      const result = deleteSession(sessions, 's2');
      expect(result).toHaveLength(2);
      expect(result.find((s) => s.session_id === 's2')).toBeUndefined();
    });

    it('returns unchanged array when deleting non-existent session', () => {
      const sessions: SessionSummary[] = [
        { session_id: 's1', workspace_id: 'ws1', title: 'A', message_count: 1, created_at: '2024-01-01T00:00:00Z' },
      ];
      const result = deleteSession(sessions, 'non-existent');
      expect(result).toHaveLength(1);
    });
  });

  describe('truncateId', () => {
    it('truncates long IDs', () => {
      expect(truncateId('abcdefghijklmnop')).toBe('abcdefgh…');
    });

    it('keeps short IDs unchanged', () => {
      expect(truncateId('short')).toBe('short');
    });
  });
});
