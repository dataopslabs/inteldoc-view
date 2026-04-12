# Implementation Plan: Memory/Chat System

## Overview

Implement the Phase 5 memory/chat system: TypeScript types for MemoryEntry/ChatRequest/ChatResponse and enhanced Session; Bedrock client wrapper with throttle retry; session CRUD handlers; chat handler with context retrieval and memory truncation; router wiring replacing the session stub; and Bedrock IAM permissions on the API Lambda. Tests use vitest with aws-sdk-client-mock for unit tests and fast-check for property-based tests.

## Tasks

- [x] 1. Update data models and add Bedrock client
  - [x] 1.1 Add `MemoryEntry`, `ChatRequest`, `ChatResponse` interfaces and enhance `Session` in `api/src/models/types.ts`
    - Add `MemoryEntry` with `role: 'user' | 'assistant'`, `content: string`, `timestamp: string`
    - Add `ChatRequest` with `message: string`
    - Add `ChatResponse` with `response: string`, `message_count: number`, `tokens: { input: number; output: number }`
    - Update existing `Session` to include `tenant_id: string`, `title: string`, and change `memory: unknown[]` to `memory: MemoryEntry[]`
    - _Requirements: 1.1, 4.5, 4.6_

  - [x] 1.2 Create Bedrock client wrapper in `api/src/lib/bedrock.ts`
    - Instantiate `BedrockRuntimeClient` with region from `AWS_REGION` env var
    - Read model ID from `BEDROCK_MODEL_ID` env var, default to `anthropic.claude-3-haiku-20240307-v1:0`
    - Implement `invokeModel(system, messages)` that sends Claude Messages API format with `max_tokens: 1024`
    - Parse response to extract `content[0].text`, `usage.input_tokens`, `usage.output_tokens`
    - Implement single retry on `ThrottlingException` or HTTP 429 with 1-second delay
    - Export `InvokeResult` interface with `response`, `inputTokens`, `outputTokens`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_


- [x] 2. Implement session CRUD handlers
  - [x] 2.1 Implement `handleCreateSession` in `api/src/handlers/sessions.ts`
    - Extract `workspace_id` from path params, optional `title` from body
    - Verify workspace exists and belongs to requesting tenant; return 403 if not owned, 404 if missing
    - Generate `session_id` via `crypto.randomUUID()`, store `tenant_id` on the record
    - Put Session_Record to sessions table with empty `memory` array and `created_at` timestamp
    - Return 201 with created session
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.2 Implement `handleListSessions` in `api/src/handlers/sessions.ts`
    - Extract `workspace_id` from path params
    - Verify workspace ownership; return 403 if not owned
    - Query `workspace-index` GSI on sessions table
    - Sort by `created_at` descending
    - Map each session to summary: `session_id`, `workspace_id`, `title`, `created_at`, `message_count` (memory.length); exclude full memory
    - Return `{ sessions: [...], count: N }`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.3 Implement `handleGetSession` in `api/src/handlers/sessions.ts`
    - Get Session_Record by `session_id`; return 404 if missing
    - Verify tenant ownership via workspace lookup; return 403 if not owned
    - Return full session including memory array
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.4 Implement `handleDeleteSession` in `api/src/handlers/sessions.ts`
    - Get Session_Record by `session_id`; return 404 if missing
    - Verify tenant ownership; return 403 if not owned
    - Delete item from sessions table
    - Return 200 with confirmation message
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 3. Checkpoint — Verify session handlers compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement context retrieval and memory truncation
  - [x] 4.1 Implement `retrieveContext` in `api/src/handlers/chat.ts`
    - Query `workspace-index` GSI on traces table for the workspace
    - Filter to traces with `status === "completed"` and non-empty `fields`
    - Sort by `created_at` descending (newest first)
    - Format each trace as structured text: `Document: {filename} (trace: {trace_id})\nFields:\n- {field_name}: {value}\n...`
    - Estimate tokens using `chars / 4` approximation; truncate oldest traces if over context budget (4000 tokens)
    - Return empty string if no completed traces
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 4.2 Implement `truncateMemory` and `estimateTokens` in `api/src/handlers/chat.ts`
    - `estimateTokens` returns sum of `Math.ceil(entry.content.length / 4)` for each entry
    - `truncateMemory` applies sliding window: remove oldest pair (2 entries) until within `MEMORY_TOKEN_BUDGET` (4000 tokens)
    - Always retain minimum `MIN_RECENT_EXCHANGES * 2` entries (4 messages)
    - Return the truncated window as a contiguous suffix of the original array
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 4.3 Write property test: memory truncation preserves minimum recent exchanges
    - **Property 1: Memory truncation preserves minimum recent exchanges**
    - Generate random memory arrays of varying lengths and content sizes using fast-check
    - Verify truncation result has at least 4 entries when original has >= 4
    - **Validates: Requirements 6.1, 6.2**

  - [x] 4.4 Write property test: memory truncation removes oldest entries first
    - **Property 2: Memory truncation removes oldest entries first**
    - Generate random memory arrays, verify truncated result is a contiguous suffix of the original
    - **Validates: Requirements 6.1**

  - [x] 4.5 Write property test: truncated memory is within budget or at minimum size
    - **Property 3: Truncated memory token count is within budget or at minimum size**
    - Generate random memory arrays, verify post-truncation token count <= budget OR window length == 4
    - **Validates: Requirements 6.1, 6.2**

  - [x] 4.6 Write property test: context truncation respects token budget
    - **Property 5: Context truncation respects token budget**
    - Generate random sets of trace field data with varying sizes, verify formatted context fits within budget
    - **Validates: Requirements 5.5**

  - [x] 4.7 Write property test: token estimation is proportional to content length
    - **Property 9: Token estimation is proportional to content length**
    - Generate random content strings, verify token estimate equals `sum of ceil(content.length / 4)`
    - **Validates: Requirements 6.4**

- [x] 5. Implement chat message handler and prompt construction
  - [x] 5.1 Implement `buildPrompt` in `api/src/handlers/chat.ts`
    - Accept `context` string, `memory` MemoryEntry array, and `userMessage` string
    - Build system prompt: if context non-empty, include document data instructions with context; if empty, instruct LLM to tell user no documents are available
    - Apply `truncateMemory` to memory, then map to `{ role, content }` messages
    - Append user message as final message
    - Return `{ system, messages }` object
    - _Requirements: 4.3, 5.4_

  - [x] 5.2 Implement `handleChatMessage` in `api/src/handlers/chat.ts`
    - Validate `message` field is non-empty string; return 400 if missing or empty
    - Get Session_Record by `session_id`; return 404 if missing
    - Verify tenant ownership via workspace lookup; return 403 if not owned
    - Call `retrieveContext(workspace_id)` for grounding context
    - Call `buildPrompt(context, session.memory, message)` to construct prompt
    - Call `invokeModel(system, messages)` from bedrock client
    - On Bedrock failure: return 502 without appending memory entries
    - On success: create two MemoryEntry items (user + assistant) with timestamps
    - Append both entries to session memory using DynamoDB `list_append` update
    - Return `{ response, message_count, tokens: { input, output } }`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

  - [x] 5.3 Write property test: chat exchange appends exactly two memory entries
    - **Property 6: Chat exchange appends exactly two memory entries**
    - Generate random existing memory arrays and new messages, verify exactly 2 entries appended with roles `user` then `assistant`
    - **Validates: Requirements 4.5**

  - [x] 5.4 Write property test: prompt includes all components in correct order
    - **Property 10: Prompt construction includes all components in correct order**
    - Generate non-empty context, non-empty memory, and user message; verify system string contains context, messages array has memory entries first and user message last
    - **Validates: Requirements 4.3**

- [x] 6. Checkpoint — Verify chat handler compiles
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Wire routes and update infrastructure
  - [x] 7.1 Update `api/src/router.ts` to import session and chat handlers and replace stubs with real routes
    - Import `handleCreateSession`, `handleListSessions`, `handleGetSession`, `handleDeleteSession` from `./handlers/sessions`
    - Import `handleChatMessage` from `./handlers/chat`
    - Add route `POST /v1/workspaces/:id/sessions` → `handleCreateSession`
    - Add route `GET /v1/workspaces/:id/sessions` → `handleListSessions`
    - Add route `GET /v1/sessions/:id` → `handleGetSession`
    - Add route `DELETE /v1/sessions/:id` → `handleDeleteSession`
    - Add route `POST /v1/sessions/:id/chat` → `handleChatMessage`
    - Remove `/v1/sessions/:id/chat` from `stubPaths` array
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 7.1_

  - [x] 7.2 Add Bedrock permissions and environment variable to `infra/lib/api-stack.ts`
    - Add `bedrock:InvokeModel` IAM policy statement to the API Lambda for Claude Haiku and Sonnet model ARNs
    - Add `BEDROCK_MODEL_ID` environment variable to the API Lambda function
    - _Requirements: 9.1_

- [x] 8. Write unit tests and remaining property tests
  - [x] 8.1 Write property test: failed Bedrock call leaves memory unchanged
    - **Property 7: Failed Bedrock call leaves memory unchanged**
    - Mock Bedrock to throw, send chat message, verify session memory is identical to pre-request state
    - **Validates: Requirements 4.10**

  - [x] 8.2 Write property test: session list excludes full memory contents
    - **Property 8: Session list excludes full memory contents**
    - Generate sessions with varying memory sizes, call list handler, verify each result has `message_count` number but no `memory` array
    - **Validates: Requirements 2.5**

  - [x] 8.3 Write property test: context retrieval only includes completed traces
    - **Property 4: Context retrieval only includes completed traces**
    - Generate workspace with mix of trace statuses, verify context string only contains data from completed traces
    - **Validates: Requirements 5.1**

  - [x] 8.4 Write property test: context retrieval does not leak cross-workspace data
    - **Property 12: Context retrieval does not leak cross-workspace data**
    - Generate traces across multiple workspaces, verify context for workspace W only contains traces from W
    - **Validates: Requirements 8.4**

  - [x] 8.5 Write unit tests for Bedrock client in `api/src/__tests__/bedrock.test.ts`
    - Mock `BedrockRuntimeClient` using `aws-sdk-client-mock`
    - Test successful invocation returns parsed response and token counts
    - Test throttle retry: first call throws ThrottlingException, second succeeds
    - Test throttle retry exhausted: both calls throw, error propagates
    - Test empty content array returns empty response string
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 8.6 Write unit tests for session CRUD handlers in `api/src/__tests__/sessions.test.ts`
    - Mock DynamoDB using `aws-sdk-client-mock`
    - Test create session: success with title, success with default title, 403 on wrong tenant, 404 on missing workspace
    - Test list sessions: returns summaries without memory, sorted descending, includes count
    - Test get session: returns full session with memory, 404 on missing, 403 on wrong tenant
    - Test delete session: success with confirmation, 404 on missing, 403 on wrong tenant
    - _Requirements: 1.1–1.5, 2.1–2.5, 3.1–3.4, 7.1–7.5, 8.1–8.3_

  - [x] 8.7 Write unit tests for chat handler in `api/src/__tests__/chat.test.ts`
    - Mock DynamoDB and Bedrock client
    - Test successful chat message: response returned, memory appended with 2 entries
    - Test 400 on missing/empty message
    - Test 404 on missing session
    - Test 403 on wrong tenant
    - Test 502 on Bedrock failure, memory unchanged
    - Test chat with empty workspace (no traces): system prompt tells user to process documents
    - Test chat with zero memory: first exchange works
    - Test multi-turn: send 3 messages, verify memory grows correctly
    - _Requirements: 4.1–4.10, 5.4, 8.1–8.3_

  - [x] 8.8 Write unit tests for context retrieval and memory truncation in `api/src/__tests__/chat-memory.test.ts`
    - Test memory at exactly minimum size (4 entries): no truncation
    - Test memory with one very long message exceeding budget: truncated to minimum window
    - Test context with mix of completed/pending/failed traces: only completed included
    - Test context with no completed traces: returns empty string
    - Test context truncation removes oldest traces first
    - _Requirements: 5.1–5.5, 6.1–6.4_

- [x] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- TypeScript is used for all code in this spec
- Property tests use `fast-check`, unit tests use `vitest` with `aws-sdk-client-mock`
- All endpoints enforce tenant isolation via workspace ownership checks (Requirements 8.1–8.4)
- The Bedrock client requires `@aws-sdk/client-bedrock-runtime` as a new production dependency
- Memory truncation sends only a sliding window to the LLM but preserves full history in DynamoDB
