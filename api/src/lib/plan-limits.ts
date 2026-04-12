import { Plan, PlanLimits, Tenant } from '../models/types';

export const DEFAULT_PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    workspaces: 2,
    docs_per_month: 10,
    tokens_per_month: 100_000,
    chats_per_month: 50,
  },
  pro: {
    workspaces: 20,
    docs_per_month: 500,
    tokens_per_month: 5_000_000,
    chats_per_month: 2_000,
  },
  enterprise: {
    workspaces: Infinity,
    docs_per_month: Infinity,
    tokens_per_month: Infinity,
    chats_per_month: Infinity,
  },
};

export const SOFT_LIMIT_RATIO = 0.8;

export function getEffectiveLimits(tenant: Tenant): PlanLimits {
  if (tenant.admin_override_limits) {
    return tenant.admin_override_limits;
  }
  if (tenant.downgrade_at && tenant.previous_plan) {
    const graceExpiry = new Date(tenant.downgrade_at);
    graceExpiry.setDate(graceExpiry.getDate() + 7);
    if (new Date() < graceExpiry) {
      return DEFAULT_PLAN_LIMITS[tenant.previous_plan];
    }
  }
  return DEFAULT_PLAN_LIMITS[tenant.plan];
}

export function getSoftLimit(hardLimit: number): number {
  if (hardLimit === Infinity) return Infinity;
  return Math.floor(hardLimit * SOFT_LIMIT_RATIO);
}
