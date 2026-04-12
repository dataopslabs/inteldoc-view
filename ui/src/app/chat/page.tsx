'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Header from '@/components/Header';
import { Skeleton } from '@/components/Skeleton';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useToast } from '@/components/ToastProvider';
import { api, Workspace, Session, SessionSummary, MemoryEntry } from '@/lib/api';

// T1-04: Max message length — mirrors server-side limit
const MAX_MESSAGE_LENGTH = 4000;

interface DisplayMessage {
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: string;
  tokens?: { input: number; output: number };
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function truncateId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) + '…' : id;
}

export default function ChatPage() {
  const { showToast } = useToast();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);

  // T2-03: Inline session delete confirmation (replaces window.confirm())
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, sending]);

  // Fetch workspaces on mount
  useEffect(() => {
    api.workspaces.list()
      .then((res) => setWorkspaces(res.workspaces))
      .catch(() => {/* silently fail, dropdown will be empty */})
      .finally(() => setLoadingWorkspaces(false));
  }, []);

  // Fetch sessions when workspace changes
  const fetchSessions = useCallback(async (workspaceId: string) => {
    if (!workspaceId) {
      setSessions([]);
      setActiveSessionId(null);
      setMessages([]);
      return;
    }
    setLoadingSessions(true);
    setSessionsError(null);
    try {
      const res = await api.sessions.list(workspaceId);
      const sorted = [...res.sessions].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setSessions(sorted);
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to fetch sessions');
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    if (selectedWorkspace) {
      setActiveSessionId(null);
      setMessages([]);
      fetchSessions(selectedWorkspace);
    } else {
      setSessions([]);
      setActiveSessionId(null);
      setMessages([]);
    }
  }, [selectedWorkspace, fetchSessions]);

  // Select a session and load its messages
  const selectSession = useCallback(async (sessionId: string) => {
    setActiveSessionId(sessionId);
    setLoadingMessages(true);
    setMessages([]);
    try {
      const session: Session = await api.sessions.get(sessionId);
      const displayMessages: DisplayMessage[] = session.memory.map((m: MemoryEntry) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }));
      setMessages(displayMessages);
    } catch (err) {
      setMessages([{
        role: 'error',
        content: err instanceof Error ? err.message : 'Failed to load session',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Create a new chat session
  const createSession = useCallback(async () => {
    if (!selectedWorkspace || creatingSession) return;
    setCreatingSession(true);
    try {
      const session = await api.sessions.create(selectedWorkspace);
      const summary: SessionSummary = {
        session_id: session.session_id,
        workspace_id: session.workspace_id,
        title: session.title,
        message_count: 0,
        created_at: session.created_at,
      };
      setSessions((prev) => [summary, ...prev]);
      setActiveSessionId(session.session_id);
      setMessages([]);
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setCreatingSession(false);
    }
  }, [selectedWorkspace, creatingSession]);

  // Send a message
  const sendMessage = useCallback(async () => {
    if (!activeSessionId || !message.trim() || sending) return;
    // T1-04: Client-side length check mirrors server validation
    if (message.length > MAX_MESSAGE_LENGTH) {
      showToast(`Message too long (${message.length}/${MAX_MESSAGE_LENGTH} chars)`, 'error');
      return;
    }
    const userMsg = message.trim();
    setMessage('');
    setSending(true);

    const userDisplay: DisplayMessage = {
      role: 'user',
      content: userMsg,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userDisplay]);

    try {
      const res = await api.sessions.chat(activeSessionId, userMsg);
      const assistantDisplay: DisplayMessage = {
        role: 'assistant',
        content: res.response,
        timestamp: new Date().toISOString(),
        tokens: res.tokens,
      };
      setMessages((prev) => [...prev, assistantDisplay]);
      setSessions((prev) =>
        prev.map((s) =>
          s.session_id === activeSessionId
            ? { ...s, message_count: res.message_count }
            : s
        )
      );
    } catch (err) {
      const errorDisplay: DisplayMessage = {
        role: 'error',
        content: err instanceof Error ? err.message : 'Failed to send message',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorDisplay]);
      setMessage(userMsg); // T4-01: restore message on error
    } finally {
      setSending(false);
    }
  }, [activeSessionId, message, sending, showToast]);

  // T2-03: Inline delete confirmation — show confirm UI instead of window.confirm()
  const requestDeleteSession = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingSessionId(sessionId);
  }, []);

  const confirmDeleteSession = useCallback(async (sessionId: string) => {
    setDeletingSessionId(null);
    try {
      await api.sessions.delete(sessionId);
      setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
      showToast('Session deleted', 'info');
    } catch {
      showToast('Failed to delete session', 'error');
    }
  }, [activeSessionId, showToast]);

  const cancelDeleteSession = useCallback(() => {
    setDeletingSessionId(null);
  }, []);

  // T4-05: Handle Enter/Shift+Enter in textarea for multi-line support
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    // Shift+Enter inserts newline — default textarea behavior, no override needed
  };

  const charsRemaining = MAX_MESSAGE_LENGTH - message.length;

  const selectStyle: React.CSSProperties = {
    backgroundColor: '#18191b',
    color: '#d0d6e0',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '13px',
    outline: 'none',
    width: '100%',
  };

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: '#08090a' }}>
      <Header title="Chat" />
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel - sidebar */}
        <div
          className="flex flex-col shrink-0"
          style={{
            width: '280px',
            borderRight: '1px solid rgba(255,255,255,0.06)',
            backgroundColor: '#0f1011',
          }}
        >
          {/* Workspace selector */}
          <div className="p-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {loadingWorkspaces ? (
              <Skeleton variant="text" />
            ) : (
              <select
                value={selectedWorkspace}
                onChange={(e) => setSelectedWorkspace(e.target.value)}
                style={selectStyle}
                aria-label="Select workspace"
              >
                <option value="">Select a workspace</option>
                {workspaces.map((ws) => (
                  <option key={ws.workspace_id} value={ws.workspace_id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* New chat button */}
          <div className="p-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              onClick={createSession}
              disabled={!selectedWorkspace || creatingSession}
              className="w-full text-xs font-medium py-2 px-3 rounded transition-colors"
              style={{
                backgroundColor: selectedWorkspace ? '#7170ff' : 'rgba(255,255,255,0.04)',
                color: selectedWorkspace ? '#fff' : '#62666d',
                border: 'none',
                cursor: selectedWorkspace ? 'pointer' : 'not-allowed',
                opacity: creatingSession ? 0.6 : 1,
              }}
            >
              {creatingSession ? 'Creating…' : '+ New chat'}
            </button>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto">
            {loadingSessions ? (
              <div className="p-3 space-y-2">
                <Skeleton variant="row" count={4} />
              </div>
            ) : sessionsError ? (
              <div className="p-3">
                <p className="text-xs" style={{ color: '#ef4444' }}>{sessionsError}</p>
              </div>
            ) : !selectedWorkspace ? (
              <div className="p-3 text-center py-8">
                <p className="text-xs" style={{ color: '#62666d' }}>Select a workspace to view sessions</p>
              </div>
            ) : sessions.length === 0 ? (
              <div className="p-3 text-center py-8">
                <div className="text-2xl mb-2">💬</div>
                <p className="text-xs" style={{ color: '#62666d' }}>No sessions yet</p>
              </div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.session_id}
                  className="relative"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <div
                    className="flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors"
                    style={{
                      backgroundColor: activeSessionId === s.session_id ? 'rgba(113,112,255,0.1)' : 'transparent',
                    }}
                    onClick={() => {
                      if (deletingSessionId !== s.session_id) selectSession(s.session_id);
                    }}
                    onMouseEnter={(e) => {
                      if (activeSessionId !== s.session_id && deletingSessionId !== s.session_id) {
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.04)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.backgroundColor =
                        activeSessionId === s.session_id ? 'rgba(113,112,255,0.1)' : 'transparent';
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (deletingSessionId !== s.session_id) selectSession(s.session_id);
                      }
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: '#d0d6e0' }}>
                        {s.title || `Chat ${truncateId(s.session_id)}`}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: '#62666d' }}>
                        {s.message_count} message{s.message_count !== 1 ? 's' : ''} · {formatTimestamp(s.created_at)}
                      </p>
                    </div>
                    {/* T2-03: Delete button triggers inline confirm — no window.confirm() */}
                    {deletingSessionId !== s.session_id && (
                      <button
                        onClick={(e) => requestDeleteSession(s.session_id, e)}
                        className="shrink-0 text-xs px-1.5 py-0.5 rounded transition-colors"
                        style={{ color: '#62666d', backgroundColor: 'transparent' }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.color = '#ef4444';
                          (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(239,68,68,0.1)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.color = '#62666d';
                          (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                        }}
                        aria-label={`Delete session ${s.title || s.session_id}`}
                        title="Delete session"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* T2-03: Inline confirmation — replaces window.confirm() */}
                  {deletingSessionId === s.session_id && (
                    <div
                      className="flex items-center gap-2 px-3 py-2"
                      style={{ backgroundColor: 'rgba(239,68,68,0.08)', borderTop: '1px solid rgba(239,68,68,0.15)' }}
                    >
                      <span className="text-xs flex-1" style={{ color: '#ef4444' }}>Delete this session?</span>
                      <button
                        onClick={() => confirmDeleteSession(s.session_id)}
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ backgroundColor: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                      <button
                        onClick={cancelDeleteSession}
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ backgroundColor: 'rgba(255,255,255,0.06)', color: '#8a8f98', border: 'none', cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel - conversation */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Message thread */}
          <div
            ref={threadRef}
            className="flex-1 overflow-y-auto p-6 space-y-4"
          >
            <ErrorBoundary section="Chat messages">
              {!activeSessionId ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <div className="text-4xl">🤖</div>
                  <p className="text-sm" style={{ color: '#62666d' }}>
                    {selectedWorkspace
                      ? 'Select a session or start a new chat'
                      : 'Select a workspace to get started'}
                  </p>
                </div>
              ) : loadingMessages ? (
                <div className="space-y-3">
                  <Skeleton variant="row" count={3} />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <div className="text-4xl">💬</div>
                  <p className="text-sm" style={{ color: '#62666d' }}>
                    Send a message to start the conversation
                  </p>
                </div>
              ) : (
                messages.map((msg, idx) => {
                  if (msg.role === 'error') {
                    return (
                      <div key={idx} className="flex justify-center">
                        <div
                          className="text-xs px-4 py-2 rounded-lg max-w-md text-center"
                          style={{
                            backgroundColor: 'rgba(239,68,68,0.1)',
                            color: '#ef4444',
                            border: '1px solid rgba(239,68,68,0.2)',
                          }}
                        >
                          {msg.content}
                        </div>
                      </div>
                    );
                  }

                  const isUser = msg.role === 'user';
                  return (
                    <div
                      key={idx}
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className="max-w-[70%] rounded-lg px-4 py-3"
                        style={{
                          backgroundColor: isUser ? 'rgba(113,112,255,0.15)' : '#0f1011',
                          border: isUser
                            ? '1px solid rgba(113,112,255,0.3)'
                            : '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        <p
                          className="text-sm whitespace-pre-wrap"
                          style={{ color: '#d0d6e0', lineHeight: '1.6' }}
                        >
                          {msg.content}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs" style={{ color: '#62666d' }}>
                            {formatTimestamp(msg.timestamp)}
                          </span>
                          {msg.tokens && (
                            <span className="text-xs" style={{ color: '#4a4f57' }}>
                              · {msg.tokens.input + msg.tokens.output} tokens
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {/* Typing indicator */}
              {sending && (
                <div className="flex justify-start">
                  <div
                    className="rounded-lg px-4 py-3"
                    style={{
                      backgroundColor: '#0f1011',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      {[0, 150, 300].map((delay) => (
                        <span
                          key={delay}
                          className="inline-block w-2 h-2 rounded-full animate-bounce"
                          style={{ backgroundColor: '#7170ff', animationDelay: `${delay}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </ErrorBoundary>
          </div>

          {/* Message input bar */}
          <div
            className="shrink-0 px-6 py-4"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="flex items-end gap-3">
              {/* T4-05: textarea for multi-line support (Shift+Enter) */}
              <div className="flex-1 relative">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    !activeSessionId
                      ? 'Select a session to start chatting'
                      : 'Type a message… (Shift+Enter for new line)'
                  }
                  disabled={!activeSessionId || sending}
                  rows={1}
                  maxLength={MAX_MESSAGE_LENGTH}
                  className="w-full text-sm px-4 py-2.5 rounded-lg outline-none transition-colors resize-none"
                  style={{
                    backgroundColor: '#18191b',
                    color: '#d0d6e0',
                    border: `1px solid ${charsRemaining < 100 ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    opacity: !activeSessionId ? 0.5 : 1,
                    minHeight: '42px',
                    maxHeight: '120px',
                    overflowY: 'auto',
                  }}
                  aria-label="Chat message input"
                />
                {/* T1-04: Character counter appears when approaching limit */}
                {activeSessionId && message.length > MAX_MESSAGE_LENGTH * 0.8 && (
                  <div
                    className="absolute bottom-1 right-2 text-xs pointer-events-none"
                    style={{ color: charsRemaining < 100 ? '#f59e0b' : '#62666d' }}
                  >
                    {charsRemaining}
                  </div>
                )}
              </div>
              <button
                onClick={sendMessage}
                disabled={!activeSessionId || !message.trim() || sending || message.length > MAX_MESSAGE_LENGTH}
                className="text-xs font-medium px-4 py-2.5 rounded-lg transition-colors shrink-0"
                style={{
                  backgroundColor:
                    activeSessionId && message.trim() && !sending && message.length <= MAX_MESSAGE_LENGTH
                      ? '#7170ff'
                      : 'rgba(255,255,255,0.04)',
                  color:
                    activeSessionId && message.trim() && !sending && message.length <= MAX_MESSAGE_LENGTH
                      ? '#fff'
                      : '#62666d',
                  border: 'none',
                  cursor:
                    activeSessionId && message.trim() && !sending && message.length <= MAX_MESSAGE_LENGTH
                      ? 'pointer'
                      : 'not-allowed',
                }}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
