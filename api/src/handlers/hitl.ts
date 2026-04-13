import { ApiRequest, ApiResponse, Correction, HitlReview, Trace, Workspace } from '../models/types';
import { getItem, queryIndex, queryIndexPaginated, updateItem, TABLE_NAMES, docClient, TransactWriteCommand } from '../lib/dynamo';
import { invalidateMetricsCache } from './observability';
import { auditLog } from '../lib/audit-logger';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const ebClient = new EventBridgeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'default';

// T3-09: applyCorrections handles both 'field' and 'field_name' keys to cover
// the Python FieldResult model (uses 'field') and the TS Correction model (uses 'field_name').
export function applyCorrections(
  fields: Array<{ field?: string; field_name?: string; value: unknown; confidence: number }>,
  corrections: Correction[]
): Array<{ field?: string; field_name?: string; value: unknown; confidence: number }> {
  const correctionMap = new Map<string, unknown>();
  // Later corrections override earlier ones for the same field name
  for (const c of corrections) {
    correctionMap.set(c.field_name, c.corrected_value);
  }
  return fields.map(field => {
    // Support both 'field' (Python FieldResult) and 'field_name' keys
    const key = field.field_name ?? field.field ?? '';
    if (correctionMap.has(key)) {
      return { ...field, value: correctionMap.get(key), confidence: 1.0 };
    }
    return field;
  });
}

/**
 * Helper: verify tenant owns the workspace that a trace belongs to.
 * Returns the workspace if owned, or an ApiResponse error if not.
 */
async function verifyTenantOwnership(
  traceId: string,
  tenantId: string
): Promise<{ trace: Trace; workspace: Workspace } | ApiResponse> {
  const trace = await getItem<Trace>(TABLE_NAMES.traces, { trace_id: traceId });
  if (!trace) {
    return { statusCode: 404, body: { error: 'Trace not found' } };
  }
  const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: trace.workspace_id });
  if (!workspace || workspace.tenant_id !== tenantId) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }
  return { trace, workspace };
}

function isErrorResponse(result: unknown): result is ApiResponse {
  return typeof result === 'object' && result !== null && 'statusCode' in result;
}

/**
 * GET /v1/hitl
 * Query params: workspace_id (optional), status (optional), limit (optional), next_token (optional)
 *
 * T1-01: When no filters given, query tenant-index to return all reviews for this tenant.
 * T1-06: When filtering by status only, scope results to this tenant to prevent cross-tenant leak.
 * T1-02: Paginated via queryIndexPaginated with limit/next_token params.
 */
export async function handleListReviews(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const workspaceId = req.queryParams?.workspace_id;
  const status = req.queryParams?.status;
  const limit = Math.min(parseInt(req.queryParams?.limit ?? '50', 10) || 50, 100);
  const nextToken = req.queryParams?.next_token;

  // If workspace_id provided, verify tenant owns it
  if (workspaceId) {
    const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: workspaceId });
    if (!workspace || workspace.tenant_id !== tenant.tenant_id) {
      return { statusCode: 403, body: { error: 'Forbidden' } };
    }
  }

  let reviews: HitlReview[];
  let responseNextToken: string | undefined;

  if (workspaceId && status) {
    // Both filters: query workspace-index then filter by status
    const result = await queryIndexPaginated<HitlReview>(
      TABLE_NAMES.hitlReviews,
      'workspace-index',
      'workspace_id',
      workspaceId,
      limit,
      nextToken
    );
    reviews = result.items.filter(r => r.status === status);
    responseNextToken = result.nextToken;
  } else if (workspaceId) {
    // Only workspace_id filter — query workspace-index GSI
    const result = await queryIndexPaginated<HitlReview>(
      TABLE_NAMES.hitlReviews,
      'workspace-index',
      'workspace_id',
      workspaceId,
      limit,
      nextToken
    );
    reviews = result.items;
    responseNextToken = result.nextToken;
  } else if (status) {
    // T1-06: status-only — query status-index but SCOPE to current tenant to prevent cross-tenant leak
    const result = await queryIndexPaginated<HitlReview>(
      TABLE_NAMES.hitlReviews,
      'status-index',
      'status',
      status,
      limit,
      nextToken
    );
    // Filter to this tenant's reviews only — prevents multi-tenant data leak
    reviews = result.items.filter(r => (r as any).tenant_id === tenant.tenant_id);
    responseNextToken = result.nextToken;
  } else {
    // T1-01: No filters — query tenant-index to return all reviews for this tenant
    const result = await queryIndexPaginated<HitlReview>(
      TABLE_NAMES.hitlReviews,
      'tenant-index',
      'tenant_id',
      tenant.tenant_id,
      limit,
      nextToken
    );
    reviews = result.items;
    responseNextToken = result.nextToken;
  }

  // T2-08: Sort newest first (server-side, within current page)
  reviews.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    statusCode: 200,
    body: {
      reviews,
      count: reviews.length,
      ...(responseNextToken ? { next_token: responseNextToken } : {}),
    },
  };
}

/**
 * GET /v1/hitl/:trace_id
 */
export async function handleGetReview(req: ApiRequest): Promise<ApiResponse> {
  const { trace_id } = req.pathParams;
  const tenant = req.context.tenant!;

  const review = await getItem<HitlReview>(TABLE_NAMES.hitlReviews, { trace_id });
  if (!review) {
    return { statusCode: 404, body: { error: `Review not found for trace ${trace_id}` } };
  }

  const ownershipResult = await verifyTenantOwnership(trace_id, tenant.tenant_id);
  if (isErrorResponse(ownershipResult)) {
    return ownershipResult;
  }

  return { statusCode: 200, body: { review, trace: ownershipResult.trace } };
}

/**
 * POST /v1/hitl/:trace_id/assign
 * Body: { reviewer: string }
 */
export async function handleAssignReview(req: ApiRequest): Promise<ApiResponse> {
  const { trace_id } = req.pathParams;
  const tenant = req.context.tenant!;
  const body = req.body as Record<string, unknown>;

  if (!body?.reviewer) {
    return { statusCode: 400, body: { error: 'reviewer field is required' } };
  }

  const review = await getItem<HitlReview>(TABLE_NAMES.hitlReviews, { trace_id });
  if (!review) {
    return { statusCode: 404, body: { error: `Review not found for trace ${trace_id}` } };
  }

  const ownershipResult = await verifyTenantOwnership(trace_id, tenant.tenant_id);
  if (isErrorResponse(ownershipResult)) {
    return ownershipResult;
  }

  if (review.status !== 'pending') {
    return {
      statusCode: 409,
      body: { error: `Review is currently ${review.status}, expected pending` },
    };
  }

  try {
    const assignedAt = new Date().toISOString();
    const updated = await updateItem(
      TABLE_NAMES.hitlReviews,
      { trace_id },
      'SET #status = :status, #reviewer = :reviewer, #assigned_at = :assigned_at',
      {
        '#status': 'status',
        '#reviewer': 'reviewer',
        '#assigned_at': 'assigned_at',
      },
      {
        ':status': 'in_review',
        ':reviewer': body.reviewer,
        ':assigned_at': assignedAt,
        ':pending': 'pending',
      },
      '#status = :pending'
    );

    // G6-24: Publish EventBridge notification for reviewer assignment (non-fatal)
    ebClient.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EVENT_BUS_NAME,
        Source: 'docops.hitl',
        DetailType: 'HitlReviewAssigned',
        Detail: JSON.stringify({
          trace_id,
          workspace_id: review.workspace_id,
          reviewer: body.reviewer,
          assigned_at: assignedAt,
          tenant_id: tenant.tenant_id,
        }),
        Time: new Date(),
      }],
    })).catch((err: unknown) => console.error('[hitl] EventBridge publish failed:', err));

    // G6-14: Audit the assignment
    auditLog(tenant.tenant_id, req.context.userId, 'hitl.assigned', {
      resourceId: trace_id,
      metadata: { reviewer: body.reviewer, workspace_id: review.workspace_id },
    }).catch(() => {});

    return { statusCode: 200, body: { review: updated } };
  } catch (err: unknown) {
    const error = err as { name?: string };
    if (error.name === 'ConditionalCheckFailedException') {
      return { statusCode: 409, body: { error: 'Review was modified by another request' } };
    }
    throw err;
  }
}

/**
 * POST /v1/hitl/:trace_id/corrections
 * Body: { corrections: Correction[] }
 *
 * T2-05: Use if_not_exists to handle null/missing corrections list safely.
 */
export async function handleSubmitCorrections(req: ApiRequest): Promise<ApiResponse> {
  const { trace_id } = req.pathParams;
  const tenant = req.context.tenant!;
  const body = req.body as { corrections?: Correction[] };

  // Validate corrections payload
  const corrections = body?.corrections;
  if (!Array.isArray(corrections)) {
    return { statusCode: 400, body: { error: 'corrections array is required' } };
  }
  if (corrections.length === 0) {
    return { statusCode: 400, body: { error: 'corrections array must not be empty' } };
  }

  for (const c of corrections) {
    if (!c.field_name && c.field_name !== '') {
      return { statusCode: 400, body: { error: 'Invalid correction: missing field_name' } };
    }
    if (c.original_value === undefined) {
      return { statusCode: 400, body: { error: 'Invalid correction: missing original_value' } };
    }
    if (c.corrected_value === undefined) {
      return { statusCode: 400, body: { error: 'Invalid correction: missing corrected_value' } };
    }
  }

  const review = await getItem<HitlReview>(TABLE_NAMES.hitlReviews, { trace_id });
  if (!review) {
    return { statusCode: 404, body: { error: `Review not found for trace ${trace_id}` } };
  }

  const ownershipResult = await verifyTenantOwnership(trace_id, tenant.tenant_id);
  if (isErrorResponse(ownershipResult)) {
    return ownershipResult;
  }

  if (review.status !== 'in_review') {
    return {
      statusCode: 409,
      body: { error: `Review is currently ${review.status}, expected in_review` },
    };
  }

  // T2-05: Use if_not_exists to safely initialize corrections list if attribute is absent.
  // This prevents DynamoDB error when list_append is called on a non-existent attribute.
  const updated = await updateItem(
    TABLE_NAMES.hitlReviews,
    { trace_id },
    'SET #corrections = list_append(if_not_exists(#corrections, :empty_list), :new_corrections)',
    { '#corrections': 'corrections' },
    { ':new_corrections': corrections, ':empty_list': [] }
  );

  // G6-14: Audit corrections submission
  auditLog(tenant.tenant_id, req.context.userId, 'hitl.corrections_submitted', {
    resourceId: trace_id,
    metadata: { correction_count: corrections.length, workspace_id: review.workspace_id },
  }).catch(() => {});

  return { statusCode: 200, body: { review: updated } };
}

/**
 * POST /v1/hitl/:trace_id/resolve
 */
export async function handleResolveReview(req: ApiRequest): Promise<ApiResponse> {
  const { trace_id } = req.pathParams;
  const tenant = req.context.tenant!;

  const review = await getItem<HitlReview>(TABLE_NAMES.hitlReviews, { trace_id });
  if (!review) {
    return { statusCode: 404, body: { error: `Review not found for trace ${trace_id}` } };
  }

  const ownershipResult = await verifyTenantOwnership(trace_id, tenant.tenant_id);
  if (isErrorResponse(ownershipResult)) {
    return ownershipResult;
  }

  if (review.status !== 'in_review') {
    return {
      statusCode: 409,
      body: { error: `Review is currently ${review.status}, expected in_review` },
    };
  }

  const resolvedAt = new Date().toISOString();
  const assignedAtMs = review.assigned_at ? new Date(review.assigned_at).getTime() : Date.now();
  const resolvedAtMs = new Date(resolvedAt).getTime();
  const reviewDurationMs = resolvedAtMs - assignedAtMs;
  const correctionCount = (review.corrections ?? []).length;

  // T3-09: Apply corrections to trace fields
  const trace = ownershipResult.trace;
  const traceFields = (trace as unknown as Record<string, unknown>).fields as
    Array<{ field?: string; field_name?: string; value: unknown; confidence: number }> | undefined;
  const correctedFields = applyCorrections(traceFields ?? [], review.corrections ?? []);

  // T4-11: Use DynamoDB TransactWriteItems to atomically update both the review (resolved)
  // and the trace (completed + corrected fields) in a single ACID transaction.
  // This prevents the race condition where review is resolved but trace update fails,
  // leaving data in an inconsistent state.
  try {
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLE_NAMES.hitlReviews,
            Key: { trace_id },
            UpdateExpression:
              'SET #status = :status, #resolved_at = :resolved_at, #review_duration_ms = :duration, #correction_count = :count',
            ExpressionAttributeNames: {
              '#status': 'status',
              '#resolved_at': 'resolved_at',
              '#review_duration_ms': 'review_duration_ms',
              '#correction_count': 'correction_count',
            },
            ExpressionAttributeValues: {
              ':status': 'resolved',
              ':resolved_at': resolvedAt,
              ':duration': reviewDurationMs,
              ':count': correctionCount,
              ':in_review': 'in_review',
            },
            // Optimistic lock: ensure review is still in_review at commit time
            ConditionExpression: '#status = :in_review',
          },
        },
        {
          Update: {
            TableName: TABLE_NAMES.traces,
            Key: { trace_id },
            UpdateExpression: 'SET #status = :status, #fields = :fields',
            ExpressionAttributeNames: { '#status': 'status', '#fields': 'fields' },
            ExpressionAttributeValues: { ':status': 'completed', ':fields': correctedFields },
          },
        },
      ],
    }));
  } catch (err: unknown) {
    const error = err as { name?: string };
    if (error.name === 'TransactionCanceledException') {
      return { statusCode: 409, body: { error: 'Review was modified concurrently — please retry' } };
    }
    throw err;
  }

  // T4-03: Invalidate metrics cache — HITL resolution changes HITL and trace metrics
  invalidateMetricsCache(tenant.tenant_id);

  // G6-14: Audit review resolution
  auditLog(tenant.tenant_id, req.context.userId, 'hitl.resolved', {
    resourceId: trace_id,
    metadata: {
      correction_count: correctionCount,
      review_duration_ms: reviewDurationMs,
      workspace_id: ownershipResult.workspace.workspace_id,
    },
  }).catch(() => {});

  // Return the resolved review snapshot (fetch-after-write for accuracy)
  const updatedReview = { ...review, status: 'resolved', resolved_at: resolvedAt, review_duration_ms: reviewDurationMs, correction_count: correctionCount };
  return { statusCode: 200, body: { review: updatedReview } };
}
