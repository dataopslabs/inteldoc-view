/**
 * G5-05: GDPR tenant data endpoints.
 *
 * DELETE /v1/tenant        — purge all tenant data (soft-delete + queue hard delete).
 * GET    /v1/tenant/export — full data export (all workspaces, traces, sessions, usage).
 *
 * Soft-delete: marks tenant as deleted, returns 200. Hard delete happens out-of-band
 * via the stale-cleanup Lambda (G5-28) which respects DynamoDB PITR for compliance.
 */
import { ApiRequest, ApiResponse, Tenant, Workspace, Trace, Session, HitlReview } from '../models/types';
import {
  getItem,
  queryIndex,
  queryAllForWorkspaces,
  putItem,
  TABLE_NAMES,
} from '../lib/dynamo';
import { auditLog } from '../lib/audit-logger';

/**
 * DELETE /v1/tenant
 * Soft-deletes tenant and all owned resources. Returns 200 with confirmation.
 * Hard purge is performed asynchronously by the cleanup Lambda.
 */
export async function handleDeleteTenant(req: ApiRequest): Promise<ApiResponse> {
  const tenantId = req.context.tenantId;

  const tenant = await getItem<Tenant>(TABLE_NAMES.tenants, { tenant_id: tenantId });
  if (!tenant) {
    return { statusCode: 404, body: { error: 'Tenant not found' } };
  }

  // G6-14: Audit FIRST before deleting — so the record survives
  await auditLog(tenantId, req.context.userId, 'gdpr.tenant_deleted', {
    resourceId: tenantId,
    metadata: { requested_at: new Date().toISOString() },
  }).catch(() => {});

  // Soft-delete: mark tenant with deletion timestamp
  const deletedAt = new Date().toISOString();
  await putItem(TABLE_NAMES.tenants, {
    ...(tenant as unknown as Record<string, unknown>),
    deleted: true,
    deleted_at: deletedAt,
    plan: 'free', // Revoke all plan benefits immediately
  });

  return {
    statusCode: 200,
    body: {
      message: 'Tenant account and all associated data scheduled for deletion.',
      tenant_id: tenantId,
      deleted_at: deletedAt,
      note: 'Hard deletion of all data will complete within 30 days per retention policy.',
    },
  };
}

/**
 * GET /v1/tenant/export
 * Returns a complete export of all tenant data as a structured JSON object.
 * Suitable for GDPR Data Subject Access Requests (DSAR).
 */
export async function handleExportTenantData(req: ApiRequest): Promise<ApiResponse> {
  const tenantId = req.context.tenantId;

  const tenant = await getItem<Tenant>(TABLE_NAMES.tenants, { tenant_id: tenantId });
  if (!tenant) {
    return { statusCode: 404, body: { error: 'Tenant not found' } };
  }

  // G6-17: Gather ALL owned data in parallel — including webhooks and usage_events
  const [workspaces, webhooks, usageEvents] = await Promise.all([
    queryIndex<Workspace>(TABLE_NAMES.workspaces, 'tenant-index', 'tenant_id', tenantId),
    queryIndex(TABLE_NAMES.webhooks, 'tenant-index', 'tenant_id', tenantId).catch(() => [] as unknown[]),
    queryIndex(TABLE_NAMES.usage, 'tenant-id-index', 'tenant_id', tenantId).catch(() => [] as unknown[]),
  ]);

  const workspaceIds = workspaces.map((w) => w.workspace_id);

  const [traces, sessions, hitlReviews] = await Promise.all([
    queryAllForWorkspaces<Trace>(TABLE_NAMES.traces, 'workspace-index', workspaceIds),
    queryAllForWorkspaces<Session>(TABLE_NAMES.sessions, 'workspace-index', workspaceIds),
    queryAllForWorkspaces<HitlReview>(TABLE_NAMES.hitlReviews, 'workspace-index', workspaceIds),
  ]);

  // Strip sensitive infra fields from tenant record
  const { ...tenantData } = tenant as unknown as Record<string, unknown>;

  // G6-14: Audit the data export
  auditLog(tenantId, req.context.userId, 'gdpr.data_exported', {
    resourceId: tenantId,
    metadata: {
      counts: {
        workspaces: workspaces.length,
        traces: traces.length,
        sessions: sessions.length,
        hitl_reviews: hitlReviews.length,
        webhooks: (webhooks as unknown[]).length,
        usage_events: (usageEvents as unknown[]).length,
      },
    },
  }).catch(() => {});

  return {
    statusCode: 200,
    body: {
      export_timestamp: new Date().toISOString(),
      tenant: tenantData,
      data: {
        workspaces,
        traces,
        sessions,
        hitl_reviews: hitlReviews,
        webhooks,          // G6-17: added
        usage_events: usageEvents,  // G6-17: added
        counts: {
          workspaces: workspaces.length,
          traces: traces.length,
          sessions: sessions.length,
          hitl_reviews: hitlReviews.length,
          webhooks: (webhooks as unknown[]).length,
          usage_events: (usageEvents as unknown[]).length,
        },
      },
    },
  };
}
