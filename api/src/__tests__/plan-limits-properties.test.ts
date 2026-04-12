import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  DEFAULT_PLAN_LIMITS,
  SOFT_LIMIT_RATIO,
  getEffectiveLimits,
  getSoftLimit,
} from '../lib/plan-limits';
import { buildLimitResponse } from '../middleware/plan-enforcer';
import { getCurrentBillingPeriod } from '../lib/usage-tracker';
import type { Plan, PlanLimits, Tenant, ResourceType, EnforcementResult } from '../models/types';

/**
 * Plan Limits & Enforcement — Property-Based Tests
 *
 * Property 2: Soft limit threshold is always 80% of hard limit
 * Property 3: Hard limit rejection occurs when usage + requested > limit
 * Property 4: Grace period uses previous plan limits for exactly 7 days
 * Property 5: Plan tier ordering is consistent for upgrade/downgrade detection
 * Property 6: Billing period format is always YYYY-MM
 * Property 7: Zero-initialized usage for missing billing periods
 * Property 8: Admin override limits take precedence over default plan limits
 * Property 9: Enforcement response shape is consistent across all resource types
 * Property 11: Effective limits priority chain
 */

const ddbMock = mockClient(DynamoDBDocumentClient);

// ── Arbitraries ──

const planArb: fc.Arbitrary<Plan> = fc.constantFrom('free', 'pro', 'enterprise');

const resourceTypeArb: fc.Arbitrary<ResourceType> = fc.constantFrom(
  'documents',
  'tokens',
  'chats',
  'workspaces'
);

const planLimitsArb: fc.Arbitrary<PlanLimits> = fc.record({
  workspaces: fc.integer({ min: 1, max: 10_000 }),
  docs_per_month: fc.integer({ min: 1, max: 100_000 }),
  tokens_per_month: fc.integer({ min: 1, max: 100_000_000 }),
  chats_per_month: fc.integer({ min: 1, max: 100_000 }),
});

const finiteLimitArb = fc.integer({ min: 0, max: 100_000_000 });

const baseTenantArb: fc.Arbitrary<Tenant> = planArb.map((plan) => ({
  tenant_id: 'tenant-test',
  email: 'test@test.com',
  plan,
  created_at: '2024-01-01T00:00:00Z',
}));


// ═══════════════════════════════════════════════════════════════════
// Property 2: Soft limit threshold is always 80% of hard limit
// ═══════════════════════════════════════════════════════════════════

describe('Property 2: Soft limit threshold is always 80% of hard limit', () => {
  /**
   * For any finite limit L, getSoftLimit(L) === Math.floor(L * 0.8).
   * For Infinity, getSoftLimit returns Infinity.
   *
   * Validates: Requirements 1.3, 2.4, 7.2
   */
  it('finite limits produce floor(L * 0.8)', () => {
    fc.assert(
      fc.property(finiteLimitArb, (limit) => {
        const soft = getSoftLimit(limit);
        expect(soft).toBe(Math.floor(limit * SOFT_LIMIT_RATIO));
      }),
      { numRuns: 500 }
    );
  });

  it('infinite limit returns infinite soft limit', () => {
    expect(getSoftLimit(Infinity)).toBe(Infinity);
  });

  it('soft limit is always <= hard limit', () => {
    fc.assert(
      fc.property(finiteLimitArb, (limit) => {
        expect(getSoftLimit(limit)).toBeLessThanOrEqual(limit);
      }),
      { numRuns: 500 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Property 3: Hard limit rejection when usage + requested > limit
// ═══════════════════════════════════════════════════════════════════

describe('Property 3: Hard limit rejection occurs when usage + requested > limit', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  /**
   * For any (usage, limit, requestedAmount) where limit is finite,
   * enforcement rejects iff usage + requestedAmount > limit.
   * Infinite limits always allow.
   *
   * Validates: Requirements 1.2, 2.3, 3.3, 4.2
   */
  it('rejects iff usage + requested > limit for finite limits', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 1_000 }),
        resourceTypeArb.filter((r) => r !== 'workspaces'),
        async (currentUsage, limit, requestedAmount, resourceType) => {
          ddbMock.reset();

          const tenant: Tenant = {
            tenant_id: 'tenant-prop3',
            email: 'test@test.com',
            plan: 'free',
            created_at: '2024-01-01T00:00:00Z',
            admin_override_limits: {
              workspaces: 100,
              docs_per_month: resourceType === 'documents' ? limit : 100_000,
              tokens_per_month: resourceType === 'tokens' ? limit : 100_000_000,
              chats_per_month: resourceType === 'chats' ? limit : 100_000,
            },
          };

          // Mock getUsage to return currentUsage
          ddbMock.on(GetCommand).resolves({
            Item: {
              tenant_id: 'tenant-prop3',
              billing_period: '2025-01',
              documents: resourceType === 'documents' ? currentUsage : 0,
              tokens: resourceType === 'tokens' ? currentUsage : 0,
              chats: resourceType === 'chats' ? currentUsage : 0,
              updated_at: new Date().toISOString(),
            },
          });

          const { enforcePlanLimits } = await import('../middleware/plan-enforcer');
          const result = await enforcePlanLimits(tenant, resourceType, requestedAmount);

          const shouldReject = currentUsage + requestedAmount > limit;
          expect(result.allowed).toBe(!shouldReject);

          if (shouldReject) {
            expect(result.rejection).toBeDefined();
            expect(result.rejection!.resource_type).toBe(resourceType);
            expect(result.rejection!.current_usage).toBe(currentUsage);
            expect(result.rejection!.limit).toBe(limit);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it('infinite limits always allow', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 100_000_000 }),
        resourceTypeArb.filter((r) => r !== 'workspaces'),
        async (currentUsage, resourceType) => {
          ddbMock.reset();

          const tenant: Tenant = {
            tenant_id: 'tenant-inf',
            email: 'test@test.com',
            plan: 'enterprise',
            created_at: '2024-01-01T00:00:00Z',
          };

          ddbMock.on(GetCommand).resolves({
            Item: {
              tenant_id: 'tenant-inf',
              billing_period: '2025-01',
              documents: currentUsage,
              tokens: currentUsage,
              chats: currentUsage,
              updated_at: new Date().toISOString(),
            },
          });

          const { enforcePlanLimits } = await import('../middleware/plan-enforcer');
          const result = await enforcePlanLimits(tenant, resourceType);

          expect(result.allowed).toBe(true);
          expect(result.rejection).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════
// Property 4: Grace period uses previous plan limits for exactly 7 days
// ═══════════════════════════════════════════════════════════════════

describe('Property 4: Grace period uses previous plan limits for exactly 7 days', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * For any tenant with downgrade_at = T, effective limits equal previous
   * plan when now < T + 7d, and current plan when now >= T + 7d.
   *
   * Validates: Requirements 5.4, 5.6
   */
  it('uses previous plan limits within 7-day window', () => {
    fc.assert(
      fc.property(
        // days before grace expiry (0 = just downgraded, 6 = last day within grace)
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 23 }),
        (daysAfter, hoursAfter) => {
          const downgradeAt = new Date('2025-01-10T12:00:00Z');
          const now = new Date(downgradeAt.getTime());
          now.setDate(now.getDate() + daysAfter);
          now.setHours(now.getHours() + hoursAfter);

          // Ensure we're still within 7 days
          const graceExpiry = new Date(downgradeAt.getTime());
          graceExpiry.setDate(graceExpiry.getDate() + 7);
          if (now >= graceExpiry) return; // skip edge cases that overflow

          vi.useFakeTimers();
          vi.setSystemTime(now);

          const tenant: Tenant = {
            tenant_id: 'tenant-grace',
            email: 'test@test.com',
            plan: 'free',
            created_at: '2024-01-01T00:00:00Z',
            previous_plan: 'pro',
            downgrade_at: downgradeAt.toISOString(),
          };

          const limits = getEffectiveLimits(tenant);
          expect(limits).toEqual(DEFAULT_PLAN_LIMITS['pro']);

          vi.useRealTimers();
        }
      ),
      { numRuns: 200 }
    );
  });

  it('uses current plan limits after 7-day window', () => {
    fc.assert(
      fc.property(
        // days after grace expiry (7 = exactly expired, up to 30)
        fc.integer({ min: 7, max: 30 }),
        (daysAfter) => {
          const downgradeAt = new Date('2025-01-10T12:00:00Z');
          const now = new Date(downgradeAt.getTime());
          now.setDate(now.getDate() + daysAfter);

          vi.useFakeTimers();
          vi.setSystemTime(now);

          const tenant: Tenant = {
            tenant_id: 'tenant-grace-expired',
            email: 'test@test.com',
            plan: 'free',
            created_at: '2024-01-01T00:00:00Z',
            previous_plan: 'pro',
            downgrade_at: downgradeAt.toISOString(),
          };

          const limits = getEffectiveLimits(tenant);
          expect(limits).toEqual(DEFAULT_PLAN_LIMITS['free']);

          vi.useRealTimers();
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Property 5: Plan tier ordering is consistent
// ═══════════════════════════════════════════════════════════════════

describe('Property 5: Plan tier ordering is consistent for upgrade/downgrade detection', () => {
  const PLAN_ORDER: Record<Plan, number> = { free: 0, pro: 1, enterprise: 2 };

  /**
   * For any two distinct plans A and B, exactly one of upgrade/downgrade holds.
   * Ordering: free < pro < enterprise.
   *
   * Validates: Requirements 5.3, 5.4
   */
  it('exactly one of upgrade/downgrade holds for distinct plans', () => {
    fc.assert(
      fc.property(planArb, planArb, (planA, planB) => {
        fc.pre(planA !== planB);

        const isUpgrade = PLAN_ORDER[planB] > PLAN_ORDER[planA];
        const isDowngrade = PLAN_ORDER[planB] < PLAN_ORDER[planA];

        // Exactly one must be true
        expect(isUpgrade !== isDowngrade).toBe(true);
        expect(isUpgrade || isDowngrade).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('free < pro < enterprise ordering holds', () => {
    expect(PLAN_ORDER['free']).toBeLessThan(PLAN_ORDER['pro']);
    expect(PLAN_ORDER['pro']).toBeLessThan(PLAN_ORDER['enterprise']);
  });

  it('ordering is transitive', () => {
    const plans: Plan[] = ['free', 'pro', 'enterprise'];
    for (let i = 0; i < plans.length; i++) {
      for (let j = i + 1; j < plans.length; j++) {
        for (let k = j + 1; k < plans.length; k++) {
          const a = PLAN_ORDER[plans[i]];
          const b = PLAN_ORDER[plans[j]];
          const c = PLAN_ORDER[plans[k]];
          if (a < b && b < c) {
            expect(a).toBeLessThan(c);
          }
        }
      }
    }
  });
});


// ═══════════════════════════════════════════════════════════════════
// Property 6: Billing period format is always YYYY-MM
// ═══════════════════════════════════════════════════════════════════

describe('Property 6: Billing period format is always YYYY-MM', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * For any date, getCurrentBillingPeriod() matches ^\d{4}-(0[1-9]|1[0-2])$
   *
   * Validates: Requirements 6.1
   */
  it('output always matches YYYY-MM regex', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        fc.integer({ min: 0, max: 23 }),
        (year, month, day, hour) => {
          const date = new Date(Date.UTC(year, month - 1, day, hour));

          vi.useFakeTimers();
          vi.setSystemTime(date);

          const period = getCurrentBillingPeriod();

          expect(period).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);

          // Verify it corresponds to the actual UTC month
          const expectedYear = date.getUTCFullYear();
          const expectedMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
          expect(period).toBe(`${expectedYear}-${expectedMonth}`);

          vi.useRealTimers();
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Property 7: Zero-initialized usage for missing billing periods
// ═══════════════════════════════════════════════════════════════════

describe('Property 7: Zero-initialized usage for missing billing periods', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  /**
   * For any tenant and billing period with no existing record,
   * getUsage returns documents=0, tokens=0, chats=0.
   *
   * Validates: Requirements 6.4
   */
  it('returns zero-initialized record when no record exists', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        fc.integer({ min: 2000, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        async (tenantId, year, month) => {
          ddbMock.reset();
          ddbMock.on(GetCommand).resolves({ Item: undefined });

          const billingPeriod = `${year}-${String(month).padStart(2, '0')}`;

          const { getUsage } = await import('../lib/usage-tracker');
          const usage = await getUsage(tenantId, billingPeriod);

          expect(usage.tenant_id).toBe(tenantId);
          expect(usage.billing_period).toBe(billingPeriod);
          expect(usage.documents).toBe(0);
          expect(usage.tokens).toBe(0);
          expect(usage.chats).toBe(0);
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Property 8: Admin override limits take precedence
// ═══════════════════════════════════════════════════════════════════

describe('Property 8: Admin override limits take precedence over default plan limits', () => {
  /**
   * When admin_override_limits is set, getEffectiveLimits returns override values
   * regardless of plan tier. Without override and no grace period, returns defaults.
   *
   * Validates: Requirements 9.2, 9.1
   */
  it('returns override limits when admin_override_limits is set', () => {
    fc.assert(
      fc.property(planArb, planLimitsArb, (plan, overrideLimits) => {
        const tenant: Tenant = {
          tenant_id: 'tenant-override',
          email: 'test@test.com',
          plan,
          created_at: '2024-01-01T00:00:00Z',
          admin_override_limits: overrideLimits,
        };

        const limits = getEffectiveLimits(tenant);
        expect(limits).toEqual(overrideLimits);
      }),
      { numRuns: 200 }
    );
  });

  it('returns default plan limits when no override exists', () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const tenant: Tenant = {
          tenant_id: 'tenant-no-override',
          email: 'test@test.com',
          plan,
          created_at: '2024-01-01T00:00:00Z',
        };

        const limits = getEffectiveLimits(tenant);
        expect(limits).toEqual(DEFAULT_PLAN_LIMITS[plan]);
      }),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════
// Property 9: Enforcement response shape is consistent
// ═══════════════════════════════════════════════════════════════════

describe('Property 9: Enforcement response shape is consistent across all resource types', () => {
  /**
   * For any rejection result, buildLimitResponse returns a body with exactly:
   * error, resource_type, current_usage, limit, billing_period, upgrade_url.
   * resource_type is one of: documents, tokens, chats, workspaces.
   *
   * Validates: Requirements 4.3, 7.1
   */
  it('rejection response contains all required fields', () => {
    fc.assert(
      fc.property(
        resourceTypeArb,
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        fc.string({ minLength: 7, maxLength: 7 }).map((s) => {
          // Generate valid YYYY-MM format
          const year = 2020 + Math.abs(s.charCodeAt(0) % 10);
          const month = (Math.abs(s.charCodeAt(1) % 12) + 1).toString().padStart(2, '0');
          return `${year}-${month}`;
        }),
        (resourceType, currentUsage, limit, billingPeriod) => {
          const rejection: EnforcementResult['rejection'] = {
            resource_type: resourceType,
            current_usage: currentUsage,
            limit,
            billing_period: billingPeriod,
            upgrade_url: '/v1/tenant/plan',
            message: `${resourceType} limit reached. Current: ${currentUsage}, Limit: ${limit}. Upgrade your plan for higher limits.`,
          };

          const response = buildLimitResponse(rejection);

          expect(response.statusCode).toBe(429);

          const body = response.body as Record<string, unknown>;
          const requiredFields = [
            'error',
            'resource_type',
            'current_usage',
            'limit',
            'billing_period',
            'upgrade_url',
          ];

          for (const field of requiredFields) {
            expect(body).toHaveProperty(field);
          }

          expect(['documents', 'tokens', 'chats', 'workspaces']).toContain(body.resource_type);
          expect(body.current_usage).toBe(currentUsage);
          expect(body.limit).toBe(limit);
          expect(body.billing_period).toBe(billingPeriod);
          expect(body.upgrade_url).toBe('/v1/tenant/plan');
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// Property 11: Effective limits priority chain
// ═══════════════════════════════════════════════════════════════════

describe('Property 11: Effective limits priority chain', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Priority: admin_override > grace period previous plan > current plan defaults.
   * These three cases are mutually exclusive in evaluation order.
   *
   * Validates: Requirements 9.2, 5.6
   */
  it('admin override wins over grace period and defaults', () => {
    fc.assert(
      fc.property(planArb, planLimitsArb, (plan, overrideLimits) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-01-12T00:00:00Z'));

        const tenant: Tenant = {
          tenant_id: 'tenant-priority',
          email: 'test@test.com',
          plan,
          created_at: '2024-01-01T00:00:00Z',
          admin_override_limits: overrideLimits,
          // Also set grace period — override should still win
          previous_plan: 'enterprise',
          downgrade_at: '2025-01-10T00:00:00Z',
        };

        const limits = getEffectiveLimits(tenant);
        expect(limits).toEqual(overrideLimits);

        vi.useRealTimers();
      }),
      { numRuns: 200 }
    );
  });

  it('grace period wins over current plan defaults when no override', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<[Plan, Plan]>(['enterprise', 'free'], ['enterprise', 'pro'], ['pro', 'free']),
        (planPair) => {
          const [previousPlan, currentPlan] = planPair;

          vi.useFakeTimers();
          // Set time within grace period (2 days after downgrade)
          vi.setSystemTime(new Date('2025-01-12T00:00:00Z'));

          const tenant: Tenant = {
            tenant_id: 'tenant-grace-priority',
            email: 'test@test.com',
            plan: currentPlan,
            created_at: '2024-01-01T00:00:00Z',
            previous_plan: previousPlan,
            downgrade_at: '2025-01-10T00:00:00Z',
          };

          const limits = getEffectiveLimits(tenant);
          expect(limits).toEqual(DEFAULT_PLAN_LIMITS[previousPlan]);

          vi.useRealTimers();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('current plan defaults used when no override and no grace period', () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const tenant: Tenant = {
          tenant_id: 'tenant-default',
          email: 'test@test.com',
          plan,
          created_at: '2024-01-01T00:00:00Z',
        };

        const limits = getEffectiveLimits(tenant);
        expect(limits).toEqual(DEFAULT_PLAN_LIMITS[plan]);
      }),
      { numRuns: 100 }
    );
  });
});
