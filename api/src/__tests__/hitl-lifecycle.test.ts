import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import {
  handleListReviews,
  handleGetReview,
  handleAssignReview,
  handleSubmitCorrections,
  handleResolveReview,
} from '../handlers/hitl';
import { ApiRequest, HitlReview, Correction } from '../models/types';

const ddbMock = mockClient(DynamoDBDocumentClient);

const WORKSPACES_TABLE = process.env.WORKSPACES_TABLE ?? 'docops-workspaces';
const TRACES_TABLE = process.env.TRACES_TABLE ?? 'docops-traces';
const HITL_TABLE = process.env.HITL_REVIEWS_TABLE ?? 'docops-hitl-reviews';

function makeReq(overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    method: 'GET',
    path: '/v1/hitl',
    pathParams: {},
    queryParams: {},
    body: null,
    headers: {},
    context: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      tenant: { tenant_id: 'tenant-1', email: 'test@test.com', plan: 'pro', created_at: '2024-01-01' },
    },
    ...overrides,
  };
}

/**
 * Full HITL Review Lifecycle Integration Test
 *
 * Maintains an in-memory store that simulates DynamoDB state across
 * handler calls, so each operation sees the effects of previous ones.
 *
 * Validates: Requirements 7.1, 7.2, 7.3
 */
describe('HITL Review Lifecycle Integration', () => {
  // In-memory stores keyed by table → primary key value
  let store: Record<string, Map<string, Record<string, unknown>>>;

  const workspace = {
    workspace_id: 'ws-lifecycle',
    tenant_id: 'tenant-1',
    name: 'Lifecycle Workspace',
    prompt_version: 'v1',
    hitl_threshold: 0.8,
    created_at: '2024-01-01T00:00:00Z',
  };

  const trace = {
    trace_id: 'trace-lifecycle',
    workspace_id: 'ws-lifecycle',
    status: 'hitl_required',
    confidence: 0.5,
    prompt_version: 'v1',
    created_at: '2024-01-01T09:00:00Z',
    fields: [
      { field_name: 'invoice_number', value: 'INV-001', confidence: 0.6 },
      { field_name: 'amount', value: '100.00', confidence: 0.9 },
      { field_name: 'vendor', value: 'Acme Corp', confidence: 0.4 },
    ],
  };

  const review: HitlReview = {
    trace_id: 'trace-lifecycle',
    workspace_id: 'ws-lifecycle',
    status: 'pending',
    corrections: [],
    created_at: '2024-01-01T09:01:00Z',
  };

  beforeEach(() => {
    ddbMock.reset();

    // Seed the in-memory store with initial state
    store = {
      [WORKSPACES_TABLE]: new Map([['ws-lifecycle', { ...workspace }]]),
      [TRACES_TABLE]: new Map([['trace-lifecycle', { ...trace }]]),
      [HITL_TABLE]: new Map([['trace-lifecycle', { ...review, corrections: [] }]]),
    };

    // --- Mock GetCommand: read from store ---
    ddbMock.on(GetCommand).callsFake((input) => {
      const tableName = input.TableName as string;
      const tableStore = store[tableName];
      if (!tableStore) return { Item: undefined };
      const keyValue = Object.values(input.Key as Record<string, string>)[0] as string;
      const item = tableStore.get(keyValue);
      // Return a deep copy so mutations don't leak
      return { Item: item ? JSON.parse(JSON.stringify(item)) : undefined };
    });

    // --- Mock QueryCommand: query from store ---
    ddbMock.on(QueryCommand).callsFake((input) => {
      const tableName = input.TableName as string;
      const tableStore = store[tableName];
      if (!tableStore) return { Items: [] };

      // Extract the key value from ExpressionAttributeValues
      const keyValue = Object.values(input.ExpressionAttributeValues as Record<string, string>)[0];
      // Extract the field name from ExpressionAttributeNames
      const fieldName = Object.values(input.ExpressionAttributeNames as Record<string, string>)[0];

      const items: Record<string, unknown>[] = [];
      for (const item of tableStore.values()) {
        if (item[fieldName] === keyValue) {
          items.push(JSON.parse(JSON.stringify(item)));
        }
      }
      return { Items: items };
    });

    // --- Mock UpdateCommand: update store and return updated attributes ---
    ddbMock.on(UpdateCommand).callsFake((input) => {
      const tableName = input.TableName as string;
      const tableStore = store[tableName];
      const keyValue = Object.values(input.Key as Record<string, string>)[0] as string;
      const existing = tableStore?.get(keyValue);
      if (!existing) return { Attributes: undefined };

      const expr = input.UpdateExpression as string;
      const names = (input.ExpressionAttributeNames ?? {}) as Record<string, string>;
      const values = (input.ExpressionAttributeValues ?? {}) as Record<string, unknown>;

      // Resolve an alias like #foo to its real field name via ExpressionAttributeNames
      const resolve = (alias: string): string => names[alias] ?? alias;

      // Parse SET clauses — everything after "SET "
      const setMatch = expr.match(/^SET\s+(.+)$/i);
      if (setMatch) {
        const body = setMatch[1];
        // Split on commas that are NOT inside parentheses
        const assignments: string[] = [];
        let depth = 0;
        let current = '';
        for (const ch of body) {
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
          if (ch === ',' && depth === 0) {
            assignments.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        if (current.trim()) assignments.push(current.trim());

        for (const assignment of assignments) {
          // Handle list_append with optional if_not_exists wrapper:
          // #x = list_append(if_not_exists(#x, :empty), :val)
          // #x = list_append(#x, :val)
          const listAppendIfNotExistsMatch = assignment.match(
            /([#\w]+)\s*=\s*list_append\(\s*if_not_exists\(\s*[#\w]+\s*,\s*:\w+\s*\)\s*,\s*(:\w+)\s*\)/
          );
          if (listAppendIfNotExistsMatch) {
            const targetField = resolve(listAppendIfNotExistsMatch[1]);
            const appendValue = values[listAppendIfNotExistsMatch[2]] as unknown[];
            const currentList = (existing[targetField] as unknown[]) ?? [];
            existing[targetField] = [...currentList, ...appendValue];
            continue;
          }
          // Handle list_append: #x = list_append(#x, :val)
          const listAppendMatch = assignment.match(
            /([#\w]+)\s*=\s*list_append\(\s*([#\w]+)\s*,\s*(:\w+)\s*\)/
          );
          if (listAppendMatch) {
            const targetField = resolve(listAppendMatch[1]);
            const appendValue = values[listAppendMatch[3]] as unknown[];
            const currentList = (existing[targetField] as unknown[]) ?? [];
            existing[targetField] = [...currentList, ...appendValue];
            continue;
          }

          // Handle simple SET: #field = :value
          const simpleMatch = assignment.match(/([#\w]+)\s*=\s*(:\w+)/);
          if (simpleMatch) {
            const fieldName = resolve(simpleMatch[1]);
            existing[fieldName] = values[simpleMatch[2]];
          }
        }
      }

      tableStore.set(keyValue, existing);
      return { Attributes: JSON.parse(JSON.stringify(existing)) };
    });

    // --- Mock TransactWriteCommand: apply all transact items to store ---
    ddbMock.on(TransactWriteCommand).callsFake((input) => {
      for (const item of (input.TransactItems ?? [])) {
        if (item.Update) {
          const u = item.Update;
          const tblName = u.TableName as string;
          const tblStore = store[tblName];
          if (!tblStore) continue;
          const keyVal = Object.values(u.Key as Record<string, string>)[0] as string;
          const existing = tblStore.get(keyVal);
          if (!existing) continue;
          const names = (u.ExpressionAttributeNames ?? {}) as Record<string, string>;
          const vals = (u.ExpressionAttributeValues ?? {}) as Record<string, unknown>;
          const resolve = (alias: string): string => names[alias] ?? alias;
          const setMatch = (u.UpdateExpression as string).match(/^SET\s+(.+)$/i);
          if (setMatch) {
            for (const assignment of setMatch[1].split(',')) {
              const m = assignment.trim().match(/([#\w]+)\s*=\s*(:\w+)/);
              if (m) existing[resolve(m[1])] = vals[m[2]];
            }
          }
          tblStore.set(keyVal, existing);
        }
      }
      return {};
    });
  });

  it('full lifecycle: list → get → assign → correct → correct again → resolve', async () => {
    // ── Step 1: List reviews — verify the pending review appears ──
    const listRes = await handleListReviews(
      makeReq({ queryParams: { workspace_id: 'ws-lifecycle' } })
    );
    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.body as { reviews: HitlReview[]; count: number };
    expect(listBody.count).toBe(1);
    expect(listBody.reviews[0].trace_id).toBe('trace-lifecycle');
    expect(listBody.reviews[0].status).toBe('pending');

    // ── Step 2: Get review — verify review + trace returned ──
    const getRes = await handleGetReview(
      makeReq({ pathParams: { trace_id: 'trace-lifecycle' } })
    );
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.body as { review: HitlReview; trace: Record<string, unknown> };
    expect(getBody.review.trace_id).toBe('trace-lifecycle');
    expect(getBody.review.status).toBe('pending');
    expect(getBody.trace.trace_id).toBe('trace-lifecycle');
    expect(getBody.trace.fields).toBeDefined();
    expect((getBody.trace.fields as unknown[]).length).toBe(3);

    // ── Step 3: Assign review ──
    const assignRes = await handleAssignReview(
      makeReq({
        method: 'POST',
        pathParams: { trace_id: 'trace-lifecycle' },
        body: { reviewer: 'reviewer@example.com' },
      })
    );
    expect(assignRes.statusCode).toBe(200);
    const assignBody = assignRes.body as { review: HitlReview };
    expect(assignBody.review.status).toBe('in_review');
    expect(assignBody.review.reviewer).toBe('reviewer@example.com');
    expect(assignBody.review.assigned_at).toBeDefined();

    // ── Step 4: Submit corrections (batch 1) ──
    const corrections1: Correction[] = [
      { field_name: 'invoice_number', original_value: 'INV-001', corrected_value: 'INV-1001' },
    ];
    const correct1Res = await handleSubmitCorrections(
      makeReq({
        method: 'POST',
        pathParams: { trace_id: 'trace-lifecycle' },
        body: { corrections: corrections1 },
      })
    );
    expect(correct1Res.statusCode).toBe(200);
    const correct1Body = correct1Res.body as { review: HitlReview };
    expect(correct1Body.review.corrections).toHaveLength(1);
    expect(correct1Body.review.corrections[0].field_name).toBe('invoice_number');

    // ── Step 5: Submit corrections (batch 2) — verify both batches present ──
    const corrections2: Correction[] = [
      { field_name: 'vendor', original_value: 'Acme Corp', corrected_value: 'Acme Corporation' },
    ];
    const correct2Res = await handleSubmitCorrections(
      makeReq({
        method: 'POST',
        pathParams: { trace_id: 'trace-lifecycle' },
        body: { corrections: corrections2 },
      })
    );
    expect(correct2Res.statusCode).toBe(200);
    const correct2Body = correct2Res.body as { review: HitlReview };
    expect(correct2Body.review.corrections).toHaveLength(2);
    expect(correct2Body.review.corrections[0].field_name).toBe('invoice_number');
    expect(correct2Body.review.corrections[1].field_name).toBe('vendor');

    // ── Step 6: Resolve review ──
    const resolveRes = await handleResolveReview(
      makeReq({
        method: 'POST',
        pathParams: { trace_id: 'trace-lifecycle' },
      })
    );
    expect(resolveRes.statusCode).toBe(200);
    const resolveBody = resolveRes.body as { review: HitlReview };

    // Verify resolved review has all audit trail fields
    expect(resolveBody.review.status).toBe('resolved');
    expect(resolveBody.review.reviewer).toBe('reviewer@example.com');
    expect(resolveBody.review.assigned_at).toBeDefined();
    expect(resolveBody.review.resolved_at).toBeDefined();
    expect(typeof resolveBody.review.review_duration_ms).toBe('number');
    expect(resolveBody.review.review_duration_ms).toBeGreaterThanOrEqual(0);
    expect(resolveBody.review.correction_count).toBe(2);

    // ── Step 7: Verify trace was updated with corrections ──
    const updatedTrace = store[TRACES_TABLE].get('trace-lifecycle')!;
    expect(updatedTrace.status).toBe('completed');

    const fields = updatedTrace.fields as Array<{ field_name: string; value: unknown; confidence: number }>;
    expect(fields).toHaveLength(3);

    // invoice_number corrected
    const invoiceField = fields.find(f => f.field_name === 'invoice_number')!;
    expect(invoiceField.value).toBe('INV-1001');
    expect(invoiceField.confidence).toBe(1.0);

    // vendor corrected
    const vendorField = fields.find(f => f.field_name === 'vendor')!;
    expect(vendorField.value).toBe('Acme Corporation');
    expect(vendorField.confidence).toBe(1.0);

    // amount unchanged
    const amountField = fields.find(f => f.field_name === 'amount')!;
    expect(amountField.value).toBe('100.00');
    expect(amountField.confidence).toBe(0.9);

    // ── Step 8: Verify resolved review in store has complete audit trail ──
    const storedReview = store[HITL_TABLE].get('trace-lifecycle')!;
    expect(storedReview.status).toBe('resolved');
    expect(storedReview.reviewer).toBe('reviewer@example.com');
    expect(storedReview.assigned_at).toBeDefined();
    expect(storedReview.resolved_at).toBeDefined();
    expect(typeof storedReview.review_duration_ms).toBe('number');
    expect(storedReview.correction_count).toBe(2);
    expect((storedReview.corrections as Correction[]).length).toBe(2);
  });
});
