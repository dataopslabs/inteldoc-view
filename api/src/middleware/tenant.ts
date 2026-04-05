import { v4 as uuidv4 } from 'uuid';
import { RequestContext, Tenant } from '../models/types';
import { getItem, putItem, queryIndex, TABLE_NAMES } from '../lib/dynamo';

export async function resolveTenant(context: RequestContext, email: string): Promise<Tenant> {
  // Try to find by tenant_id from JWT claim
  if (context.tenantId) {
    const tenant = await getItem<Tenant>(TABLE_NAMES.tenants, { tenant_id: context.tenantId });
    if (tenant) {
      context.tenant = tenant;
      return tenant;
    }
  }

  // Try to find by email (first login)
  if (email) {
    const tenants = await queryIndex<Tenant>(TABLE_NAMES.tenants, 'email-index', 'email', email);
    if (tenants.length > 0) {
      context.tenant = tenants[0];
      return tenants[0];
    }
  }

  // Auto-provision new tenant on first login
  const newTenant: Tenant = {
    tenant_id: uuidv4(),
    email,
    plan: 'free',
    created_at: new Date().toISOString(),
  };
  await putItem(TABLE_NAMES.tenants, newTenant as unknown as Record<string, unknown>);
  context.tenantId = newTenant.tenant_id;
  context.tenant = newTenant;
  return newTenant;
}
