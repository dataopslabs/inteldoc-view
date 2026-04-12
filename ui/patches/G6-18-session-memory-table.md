# G6-18: Session Memory → Separate DynamoDB Table in chat.ts

## Problem
Chat session messages are stored as a `list_append` on the main sessions table item.
DynamoDB has a 400KB item size limit. With long conversations, sessions will hit this
limit and writes will fail silently or throw errors.

## Solution: Separate `session_memory` table with one item per message turn.

---

## Step 1: Add new DynamoDB table in infra/lib/api-stack.ts

```typescript
// Session Memory table — one item per message turn
const sessionMemoryTable = new dynamodb.Table(this, 'SessionMemoryTable', {
  tableName: `docops-session-memory${suffix}`,
  partitionKey: { name: 'session_id', type: dynamodb.AttributeType.STRING },
  sortKey: { name: 'turn_index', type: dynamodb.AttributeType.NUMBER },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  pointInTimeRecovery: true,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
  timeToLiveAttribute: 'expires_at',  // auto-expire old messages
});

// Grant Lambda access
sessionMemoryTable.grantReadWriteData(apiFunction);

// Add ENV var
// SESSION_MEMORY_TABLE: sessionMemoryTable.tableName
```

---

## Step 2: Update TABLE_NAMES in api/src/config/tables.ts

```typescript
export const TABLE_NAMES = {
  // ... existing tables ...
  sessionMemory: process.env.SESSION_MEMORY_TABLE ?? 'docops-session-memory',
};
```

---

## Step 3: Rewrite message persistence in api/src/handlers/chat.ts

### Old approach (list_append — 400KB risk):
```typescript
// OLD — appends to sessions item, hits 400KB limit
await updateItem(TABLE_NAMES.sessions, { session_id }, {
  UpdateExpression: 'SET messages = list_append(if_not_exists(messages, :empty), :msgs)',
  ExpressionAttributeValues: {
    ':msgs': [userMsg, assistantMsg],
    ':empty': [],
  },
});
```

### New approach (separate table, one row per turn):
```typescript
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddbDocClient } from '../utils/dynamodb';
import { TABLE_NAMES } from '../config/tables';

const SESSION_MEMORY_TTL_DAYS = 90;

async function appendTurn(
  sessionId: string,
  turnIndex: number,
  userMsg: { role: string; content: string },
  assistantMsg: { role: string; content: string },
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MEMORY_TTL_DAYS * 86400;

  await ddbDocClient.send(new PutCommand({
    TableName: TABLE_NAMES.sessionMemory,
    Item: {
      session_id: sessionId,
      turn_index: turnIndex,
      user_message: userMsg,
      assistant_message: assistantMsg,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    },
  }));
}

async function loadSessionMessages(
  sessionId: string,
  limit = 20,
): Promise<Array<{ role: string; content: string }>> {
  const result = await ddbDocClient.send(new QueryCommand({
    TableName: TABLE_NAMES.sessionMemory,
    KeyConditionExpression: 'session_id = :sid',
    ExpressionAttributeValues: { ':sid': sessionId },
    ScanIndexForward: false,  // most recent first
    Limit: limit,
  }));

  const items = (result.Items ?? []).reverse();  // oldest first for LLM context
  const messages: Array<{ role: string; content: string }> = [];
  for (const item of items) {
    if (item.user_message) messages.push(item.user_message);
    if (item.assistant_message) messages.push(item.assistant_message);
  }
  return messages;
}
```

### Updated handleChat function:

```typescript
export async function handleChat(req: ApiRequest): Promise<ApiResponse> {
  requireRole(req.context, 'viewer');

  const { session_id } = req.pathParams;
  const body = req.body as { message?: string } | null;
  const message = body?.message?.trim();

  if (!message) {
    return { statusCode: 400, body: { error: 'message is required' } };
  }

  // Load session metadata (not messages — those come from separate table)
  const session = await getItem<ChatSession>(TABLE_NAMES.sessions, { session_id });
  if (!session) {
    return { statusCode: 404, body: { error: 'Session not found' } };
  }
  if (session.tenant_id !== req.context.tenantId) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }

  // Load recent message history from session_memory table (last 20 turns = 40 msgs)
  const history = await loadSessionMessages(session_id, 20);

  // Get next turn index
  const turnIndex = Math.floor(history.length / 2);  // each turn = 2 messages

  // Call LLM with history
  const userMsg = { role: 'user' as const, content: message };
  const assistantContent = await callLLM([...history, userMsg], session);
  const assistantMsg = { role: 'assistant' as const, content: assistantContent };

  // Persist turn to separate table
  await appendTurn(session_id, turnIndex, userMsg, assistantMsg);

  // Update session metadata (updated_at only — no messages list)
  await updateItem(TABLE_NAMES.sessions, { session_id }, {
    UpdateExpression: 'SET updated_at = :ua, turn_count = if_not_exists(turn_count, :zero) + :one',
    ExpressionAttributeValues: {
      ':ua': new Date().toISOString(),
      ':zero': 0,
      ':one': 1,
    },
  });

  return {
    statusCode: 200,
    body: {
      message: assistantMsg,
      session_id,
    },
  };
}
```

### Updated handleGetSession to load messages from memory table:

```typescript
export async function handleGetSession(req: ApiRequest): Promise<ApiResponse> {
  requireRole(req.context, 'viewer');

  const { session_id } = req.pathParams;
  const session = await getItem<ChatSession>(TABLE_NAMES.sessions, { session_id });

  if (!session) return { statusCode: 404, body: { error: 'Session not found' } };
  if (session.tenant_id !== req.context.tenantId) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }

  // Load messages from separate table
  const messages = await loadSessionMessages(session_id, 100);  // last 100 turns

  return {
    statusCode: 200,
    body: { ...session, messages },
  };
}
```

---

## Step 4: Update IaC outputs

```typescript
new CfnOutput(this, 'SessionMemoryTableName', {
  value: sessionMemoryTable.tableName,
  exportName: 'DocOps-SessionMemoryTable',
});
```

Add `SESSION_MEMORY_TABLE` to Lambda environment variables.
