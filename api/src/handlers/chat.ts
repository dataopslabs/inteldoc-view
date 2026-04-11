import { ApiRequest, ApiResponse, MemoryEntry, Session, Workspace } from '../models/types';
import { getItem, queryIndex, TABLE_NAMES, docClient } from '../lib/dynamo';
import { UpdateCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { invokeModel } from '../lib/bedrock';
import { incrementUsage, recordUsageEvent } from '../lib/usage-tracker';

// G6-18: Session memory stored in a separate DynamoDB table (one item per message pair)
// to avoid the 400 KB DynamoDB item size limit on long conversations.
const SESSION_MEMORY_TABLE = process.env.SESSION_MEMORY_TABLE ?? 'docops-session-memory';
const SESSION_MEMORY_TTL_DAYS = 90;

/** Append a user+assistant turn to the session_memory table. */
async function appendMemoryTurn(
  sessionId: string,
  turnIndex: number,
  userEntry: MemoryEntry,
  assistantEntry: MemoryEntry,
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MEMORY_TTL_DAYS * 86400;
  await docClient.send(new PutCommand({
    TableName: SESSION_MEMORY_TABLE,
    Item: {
      session_id: sessionId,
      turn_index: turnIndex,
      user_message: userEntry,
      assistant_message: assistantEntry,
      created_at: userEntry.timestamp,
      expires_at: expiresAt,
    },
  }));
}

/** Load recent memory turns from the session_memory table (newest-first, then reversed). */
async function loadMemoryTurns(sessionId: string, maxTurns = 20): Promise<MemoryEntry[]> {
  const result = await docClient.send(new QueryCommand({
    TableName: SESSION_MEMORY_TABLE,
    KeyConditionExpression: 'session_id = :sid',
    ExpressionAttributeValues: { ':sid': sessionId },
    ScanIndexForward: false,  // newest first
    Limit: maxTurns,
  }));
  const items = (result.Items ?? []).reverse();  // oldest first for LLM context
  const memory: MemoryEntry[] = [];
  for (const item of items) {
    if (item.user_message) memory.push(item.user_message as MemoryEntry);
    if (item.assistant_message) memory.push(item.assistant_message as MemoryEntry);
  }
  return memory;
}

/** Token budget for context retrieved from traces */
export const CONTEXT_TOKEN_BUDGET = 4000;

/** Token budget for conversation memory sent to LLM */
export const MEMORY_TOKEN_BUDGET = 4000;

/** Minimum number of recent exchanges (pairs) to always retain */
export const MIN_RECENT_EXCHANGES = 2;

// ── Trace type used internally for context retrieval ──

interface TraceField {
  field_name: string;
  value: unknown;
}

interface TraceRecord {
  trace_id: string;
  workspace_id: string;
  status: string;
  fields?: TraceField[];
  filename?: string;
  created_at: string;
}

// ── Token estimation ──

/**
 * Estimate token count for a list of memory entries using chars/4 approximation.
 * Requirements: 6.4
 */
export function estimateTokens(entries: MemoryEntry[]): number {
  return entries.reduce((sum, e) => sum + Math.ceil(e.content.length / 4), 0);
}

// ── Memory truncation ──

/**
 * Apply sliding-window truncation to memory, removing oldest pairs first.
 * Always retains at least MIN_RECENT_EXCHANGES * 2 entries (4 messages).
 * Returns a contiguous suffix of the original array.
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */
export function truncateMemory(memory: MemoryEntry[]): MemoryEntry[] {
  const minMessages = MIN_RECENT_EXCHANGES * 2;

  if (memory.length <= minMessages) return memory;

  let window = [...memory];
  while (estimateTokens(window) > MEMORY_TOKEN_BUDGET && window.length > minMessages) {
    // Remove oldest pair (user + assistant)
    window = window.slice(2);
  }
  return window;
}

// ── Context retrieval ──

/**
 * Format a single trace's fields into a structured text block.
 */
function formatTrace(trace: TraceRecord): string {
  const header = `Document: ${trace.filename ?? 'unknown'} (trace: ${trace.trace_id})`;
  const fieldLines = (trace.fields ?? [])
    .map(f => `- ${f.field_name}: ${f.value}`)
    .join('\n');
  return `${header}\nFields:\n${fieldLines}`;
}

/**
 * Retrieve grounding context from completed workspace traces.
 * Queries the workspace-index GSI, filters to completed traces with fields,
 * formats them as structured text, and truncates oldest traces if over budget.
 * Returns empty string if no completed traces with fields exist.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
export async function retrieveContext(workspaceId: string): Promise<string> {
  const traces = await queryIndex<TraceRecord>(
    TABLE_NAMES.traces,
    'workspace-index',
    'workspace_id',
    workspaceId,
  );

  // Filter to completed traces with non-empty fields
  const completed = traces.filter(
    t => t.status === 'completed' && t.fields && t.fields.length > 0,
  );

  if (completed.length === 0) return '';

  // Sort newest first
  completed.sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Format each trace and accumulate within token budget
  const blocks: string[] = [];
  let totalTokens = 0;

  for (const trace of completed) {
    const block = formatTrace(trace);
    const blockTokens = Math.ceil(block.length / 4);

    if (totalTokens + blockTokens > CONTEXT_TOKEN_BUDGET && blocks.length > 0) {
      // Adding this block would exceed budget — stop (oldest traces dropped)
      break;
    }

    blocks.push(block);
    totalTokens += blockTokens;
  }

  return blocks.join('\n\n');
}

// ── Prompt construction ──

/**
 * Build the LLM prompt from context, memory, and user message.
 * Requirements: 4.3, 5.4
 */
export function buildPrompt(
  context: string,
  memory: MemoryEntry[],
  userMessage: string
): { system: string; messages: Array<{ role: string; content: string }> } {
  const system = context
    ? `You are a helpful document assistant for the DocOps platform. Answer questions based on the following extracted document data. If the answer is not found in the provided data, say so clearly.\n\nDocument Data:\n${context}`
    : `You are a helpful document assistant for the DocOps platform. No processed documents are available in this workspace yet. Let the user know they need to process documents first before you can answer questions about them.`;

  const memoryWindow = truncateMemory(memory);

  const messages = [
    ...memoryWindow.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  return { system, messages };
}

// ── Chat message handler ──

/**
 * POST /v1/sessions/:id/chat
 * Body: { message: string }
 * Requirements: 4.1–4.10
 */
export async function handleChatMessage(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const sessionId = req.pathParams.id;

  // T1-04: Validate message — enforce max length to prevent prompt injection and token abuse
  const MAX_MESSAGE_LENGTH = 4000;
  const body = req.body as { message?: string } | undefined;
  if (!body?.message || typeof body.message !== 'string' || body.message.trim() === '') {
    return { statusCode: 400, body: { error: 'message field is required' } };
  }
  if (body.message.length > MAX_MESSAGE_LENGTH) {
    return {
      statusCode: 400,
      body: { error: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` },
    };
  }
  const message = body.message.trim();

  // Get session
  const session = await getItem<Session>(TABLE_NAMES.sessions, { session_id: sessionId });
  if (!session) {
    return { statusCode: 404, body: { error: 'Session not found' } };
  }

  // Verify tenant ownership via workspace
  const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: session.workspace_id });
  if (!workspace) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }
  if (workspace.tenant_id !== tenant.tenant_id) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }

  // G6-18: Load memory from separate session_memory table (avoids 400 KB item limit)
  const sessionMemory = await loadMemoryTurns(sessionId, 20);

  // Retrieve grounding context
  const context = await retrieveContext(session.workspace_id);

  // Build prompt using memory loaded from separate table
  const { system, messages } = buildPrompt(context, sessionMemory, message);

  // Invoke Bedrock
  let result;
  try {
    result = await invokeModel(system, messages);
  } catch {
    return { statusCode: 502, body: { error: 'Failed to generate response from LLM service' } };
  }

  // Create memory entries
  const now = new Date().toISOString();
  const userEntry: MemoryEntry = { role: 'user', content: message, timestamp: now };
  const assistantEntry: MemoryEntry = { role: 'assistant', content: result.response, timestamp: now };

  // G6-18: Write turn to separate session_memory table (not list_append on sessions item)
  const turnIndex = Math.floor(sessionMemory.length / 2);
  await appendMemoryTurn(sessionId, turnIndex, userEntry, assistantEntry);

  // T4-06: Auto-generate session title from first message if still the default
  // Truncate message to first 60 chars for a clean title
  const isFirstMessage = sessionMemory.length === 0;
  const autoTitle = isFirstMessage && session.title === 'New Chat'
    ? message.slice(0, 60).trim() + (message.length > 60 ? '…' : '')
    : undefined;

  // Update session metadata only (updated_at + optional title — no memory list)
  await docClient.send(new UpdateCommand({
    TableName: TABLE_NAMES.sessions,
    Key: { session_id: sessionId },
    UpdateExpression: autoTitle
      ? 'SET updated_at = :now, turn_count = if_not_exists(turn_count, :zero) + :one, #title = :title'
      : 'SET updated_at = :now, turn_count = if_not_exists(turn_count, :zero) + :one',
    ExpressionAttributeNames: autoTitle ? { '#title': 'title' } : undefined,
    ExpressionAttributeValues: autoTitle
      ? { ':now': now, ':zero': 0, ':one': 1, ':title': autoTitle }
      : { ':now': now, ':zero': 0, ':one': 1 },
  }));

  // Track chat usage (fire-and-forget with error logging)
  try {
    await incrementUsage(tenant.tenant_id, 'chats', 1);
    await recordUsageEvent(tenant.tenant_id, 'chat_message', 1, {
      session_id: sessionId,
      workspace_id: session.workspace_id,
    });
  } catch (err) {
    console.error('Usage tracking failed (chat)', err);
  }

  // Track token usage (fire-and-forget with error logging)
  try {
    const totalTokens = result.inputTokens + result.outputTokens;
    await incrementUsage(tenant.tenant_id, 'tokens', totalTokens);
    await recordUsageEvent(tenant.tenant_id, 'tokens_consumed', totalTokens, {
      session_id: sessionId,
      workspace_id: session.workspace_id,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    });
  } catch (err) {
    console.error('Usage tracking failed (tokens)', err);
  }

  return {
    statusCode: 200,
    body: {
      response: result.response,
      message_count: sessionMemory.length + 2,
      tokens: { input: result.inputTokens, output: result.outputTokens },
    },
  };
}
