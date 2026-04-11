/**
 * G5-23: Audit log helper — writes immutable audit entries to DynamoDB for compliance.
 *
 * Audit entries are write-once (no updates). The audit_log table has a 7-year TTL
 * for SOC 2 and GDPR Article 30 compliance.
 *
 * Usage:
 *   await auditLog(tenantId, userId, 'workspace.deleted', { workspace_id: '...' });
 */
import { v4 as uuidv4 } from 'uuid';
import { putItem } from './dynamo';

export const AUDIT_TABLE = process.env.AUDIT_TABLE ?? 'docops-audit-log';

export type AuditAction =
  // Workspace actions
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.deleted'
  // Document actions
  | 'document.submitted'
  | 'document.batch_submitted'
  | 'document.reprocessed'
  // HITL actions
  | 'hitl.assigned'
  | 'hitl.corrections_submitted'
  | 'hitl.resolved'
  // Session actions
  | 'session.created'
  | 'session.deleted'
  // Auth actions
  | 'auth.login'
  | 'auth.logout'
  // Billing actions
  | 'plan.changed'
  | 'usage.exported'
  // GDPR actions
  | 'gdpr.data_exported'
  | 'gdpr.tenant_deleted';

export interface AuditEntry {
  audit_id: string;
  tenant_id: string;
  user_id: string;
  action: AuditAction;
  resource_id?: string;
  metadata?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  timestamp: string;
  expires_at: number; // Unix epoch — TTL for DynamoDB auto-expiry
}

/** 7 years in seconds (SOC 2 / GDPR Article 30 requirement) */
const AUDIT_TTL_SECONDS = 7 * 365 * 24 * 3600;

/**
 * Write an immutable audit log entry.
 * Fire-and-forget safe — errors are logged but never thrown.
 */
export async function auditLog(
  tenantId: string,
  userId: string,
  action: AuditAction,
  options: {
    resourceId?: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  } = {}
): Promise<void> {
  const now = new Date();
  const entry: AuditEntry = {
    audit_id: uuidv4(),
    tenant_id: tenantId,
    user_id: userId,
    action,
    resource_id: options.resourceId,
    metadata: options.metadata,
    ip_address: options.ipAddress,
    user_agent: options.userAgent,
    timestamp: now.toISOString(),
    expires_at: Math.floor(now.getTime() / 1000) + AUDIT_TTL_SECONDS,
  };

  try {
    await putItem(AUDIT_TABLE, entry as unknown as Record<string, unknown>);
  } catch (err) {
    // Audit failures must never block the primary operation
    console.error('[audit] Failed to write audit log entry', {
      action,
      tenant_id: tenantId,
      error: String(err),
    });
  }
}
