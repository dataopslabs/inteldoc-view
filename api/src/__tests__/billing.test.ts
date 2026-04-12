/**
 * G6-05: Unit tests for billing — plan order, validation logic.
 */
import { PLAN_LIMITS } from '../models/types';
import type { Plan } from '../models/types';

const PLAN_ORDER: Record<Plan, number> = { free: 0, pro: 1, enterprise: 2 };
const VALID_PLANS: Plan[] = ['free', 'pro', 'enterprise'];

describe('PLAN_LIMITS', () => {
  test('free plan has lower limits than pro', () => {
    expect(PLAN_LIMITS.free.docs_per_month).toBeLessThan(PLAN_LIMITS.pro.docs_per_month);
    expect(PLAN_LIMITS.free.workspaces).toBeLessThan(PLAN_LIMITS.pro.workspaces);
    expect(PLAN_LIMITS.free.tokens_per_month).toBeLessThan(PLAN_LIMITS.pro.tokens_per_month);
  });

  test('enterprise plan has Infinity limits', () => {
    expect(PLAN_LIMITS.enterprise.docs_per_month).toBe(Infinity);
    expect(PLAN_LIMITS.enterprise.workspaces).toBe(Infinity);
    expect(PLAN_LIMITS.enterprise.tokens_per_month).toBe(Infinity);
    expect(PLAN_LIMITS.enterprise.chats_per_month).toBe(Infinity);
  });

  test('all plans have positive finite limits for free and pro', () => {
    for (const plan of ['free', 'pro'] as Plan[]) {
      const limits = PLAN_LIMITS[plan];
      expect(limits.docs_per_month).toBeGreaterThan(0);
      expect(limits.workspaces).toBeGreaterThan(0);
      expect(limits.tokens_per_month).toBeGreaterThan(0);
      expect(limits.chats_per_month).toBeGreaterThan(0);
    }
  });
});

describe('plan order and validation', () => {
  test('plan order is ascending', () => {
    expect(PLAN_ORDER.free).toBeLessThan(PLAN_ORDER.pro);
    expect(PLAN_ORDER.pro).toBeLessThan(PLAN_ORDER.enterprise);
  });

  test('valid plans array contains all plans', () => {
    expect(VALID_PLANS).toContain('free');
    expect(VALID_PLANS).toContain('pro');
    expect(VALID_PLANS).toContain('enterprise');
  });

  test('invalid plan string is not in VALID_PLANS', () => {
    expect(VALID_PLANS.includes('premium' as Plan)).toBe(false);
    expect(VALID_PLANS.includes('basic' as Plan)).toBe(false);
  });

  test('upgrade detection', () => {
    const isUpgrade = (from: Plan, to: Plan) => PLAN_ORDER[to] > PLAN_ORDER[from];
    expect(isUpgrade('free', 'pro')).toBe(true);
    expect(isUpgrade('pro', 'enterprise')).toBe(true);
    expect(isUpgrade('pro', 'free')).toBe(false);
    expect(isUpgrade('enterprise', 'pro')).toBe(false);
    expect(isUpgrade('pro', 'pro')).toBe(false);
  });
});
