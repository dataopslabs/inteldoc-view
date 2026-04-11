import { ApiRequest, ApiResponse, Plan, Tenant } from '../models/types';
import { getEffectiveLimits } from '../lib/plan-limits';
import { getUsage, getUsageEvents, getCurrentBillingPeriod } from '../lib/usage-tracker';
import { TABLE_NAMES, queryIndex, putItem } from '../lib/dynamo';
import type { Workspace } from '../models/types';
import { auditLog } from '../lib/audit-logger';

const PLAN_ORDER: Record<Plan, number> = { free: 0, pro: 1, enterprise: 2 };
const VALID_PLANS: Plan[] = ['free', 'pro', 'enterprise'];

export async function handleGetPlan(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const limits = getEffectiveLimits(tenant);
  const billingPeriod = getCurrentBillingPeriod();
  const usage = await getUsage(tenant.tenant_id, billingPeriod);

  const workspaces = await queryIndex<Workspace>(
    TABLE_NAMES.workspaces,
    'tenant-index',
    'tenant_id',
    tenant.tenant_id
  );

  let gracePeriod: { previous_plan: Plan; downgrade_at: string; expires_at: string } | null = null;
  if (tenant.downgrade_at && tenant.previous_plan) {
    const expiry = new Date(tenant.downgrade_at);
    expiry.setDate(expiry.getDate() + 7);
    if (new Date() < expiry) {
      gracePeriod = {
        previous_plan: tenant.previous_plan,
        downgrade_at: tenant.downgrade_at,
        expires_at: expiry.toISOString(),
      };
    }
  }

  return {
    statusCode: 200,
    body: {
      plan: tenant.plan,
      billing_period: billingPeriod,
      limits,
      usage: {
        documents: usage.documents,
        tokens: usage.tokens,
        chats: usage.chats,
        workspaces: workspaces.length,
      },
      has_admin_override: !!tenant.admin_override_limits,
      grace_period: gracePeriod,
    },
  };
}

export async function handleChangePlan(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const body = req.body as { plan?: string };

  if (!body?.plan || !VALID_PLANS.includes(body.plan as Plan)) {
    return {
      statusCode: 400,
      body: { error: 'Invalid plan: must be one of free, pro, enterprise' },
    };
  }

  const newPlan = body.plan as Plan;

  if (newPlan === tenant.plan) {
    return {
      statusCode: 400,
      body: { error: `Tenant is already on the ${tenant.plan} plan` },
    };
  }

  const isUpgrade = PLAN_ORDER[newPlan] > PLAN_ORDER[tenant.plan];

  const updatedTenant: Tenant = { ...tenant, plan: newPlan };

  if (isUpgrade) {
    // Upgrades apply immediately, clear grace period
    delete updatedTenant.previous_plan;
    delete updatedTenant.downgrade_at;
  } else {
    // Downgrades set grace period
    updatedTenant.previous_plan = tenant.plan;
    updatedTenant.downgrade_at = new Date().toISOString();
  }

  await putItem(TABLE_NAMES.tenants, updatedTenant as unknown as Record<string, unknown>);

  // G6-14: Audit plan change
  auditLog(tenant.tenant_id, req.context.userId, 'plan.changed', {
    metadata: { previous_plan: tenant.plan, new_plan: newPlan, upgrade: isUpgrade },
  }).catch(() => {});

  return {
    statusCode: 200,
    body: {
      plan: updatedTenant.plan,
      previous_plan: updatedTenant.previous_plan ?? null,
      downgrade_at: updatedTenant.downgrade_at ?? null,
      upgrade: isUpgrade,
    },
  };
}

export async function handleExportUsage(req: ApiRequest): Promise<ApiResponse> {
  const tenant = req.context.tenant!;
  const billingPeriod = req.queryParams?.billing_period;

  if (!billingPeriod) {
    return {
      statusCode: 400,
      body: { error: 'billing_period query parameter is required' },
    };
  }

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billingPeriod)) {
    return {
      statusCode: 400,
      body: { error: 'Invalid billing_period: must be in YYYY-MM format' },
    };
  }

  const events = await getUsageEvents(tenant.tenant_id, billingPeriod);

  // G6-14: Audit usage export
  auditLog(tenant.tenant_id, req.context.userId, 'usage.exported', {
    metadata: { billing_period: billingPeriod, event_count: events.length },
  }).catch(() => {});

  return {
    statusCode: 200,
    body: {
      billing_period: billingPeriod,
      events,
      count: events.length,
    },
  };
}
