import { Tenant, PLAN_LIMITS } from '../models/types';
import { queryIndex, TABLE_NAMES } from '../lib/dynamo';
import { Workspace } from '../models/types';

export async function enforceWorkspaceLimit(tenant: Tenant): Promise<{ allowed: boolean; message?: string }> {
  const limit = PLAN_LIMITS[tenant.plan].workspaces;
  if (limit === Infinity) return { allowed: true };

  const workspaces = await queryIndex<Workspace>(
    TABLE_NAMES.workspaces,
    'tenant-index',
    'tenant_id',
    tenant.tenant_id
  );

  if (workspaces.length >= limit) {
    return {
      allowed: false,
      message: `Free plan allows up to ${limit} workspaces. Upgrade to Pro for more.`,
    };
  }
  return { allowed: true };
}
