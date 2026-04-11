import { Tenant, Workspace, ResourceType, EnforcementResult, ApiResponse } from '../models/types';
import { getEffectiveLimits, getSoftLimit } from '../lib/plan-limits';
import { getUsage, getCurrentBillingPeriod } from '../lib/usage-tracker';
import { queryIndex, TABLE_NAMES, atomicIncrement, getItem } from '../lib/dynamo';

// G5-18: Per-user rate limiting — sliding window via DynamoDB atomic counter.
// Limits per user per minute to prevent a single user from monopolizing the account's
// plan limits. Separate from tenant-level billing limits.
const PER_USER_LIMITS: Record<string, number> = {
  documents: 10,    // 10 doc uploads per user per minute
  chats: 30,        // 30 chat messages per user per minute
  workspaces: 5,    // 5 workspace creates per user per minute
};

/** Get the current minute bucket key (resets every 60s). */
function getMinuteBucket(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}T${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
}

export async function checkPerUserRateLimit(
  userId: string,
  resourceType: ResourceType
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const limit = PER_USER_LIMITS[resourceType];
  if (!limit) return { allowed: true }; // No per-user limit for this type

  const bucket = getMinuteBucket();
  const rateLimitKey = `ratelimit:${userId}:${resourceType}:${bucket}`;

  try {
    // Atomically increment the counter — returns the NEW value after increment
    await atomicIncrement(TABLE_NAMES.usage, { tenant_id: rateLimitKey, billing_period: 'ratelimit' }, 'count', 1);
    const record = await getItem<{ count: number }>(TABLE_NAMES.usage, { tenant_id: rateLimitKey, billing_period: 'ratelimit' });
    const count = record?.count ?? 1;
    if (count > limit) {
      return { allowed: false, retryAfterSeconds: 60 };
    }
  } catch {
    // On DynamoDB error, allow the request through — rate limiting is best-effort
    return { allowed: true };
  }

  return { allowed: true };
}

export async function enforcePlanLimits(
  tenant: Tenant,
  resourceType: ResourceType,
  requestedAmount?: number
): Promise<EnforcementResult> {
  const limits = getEffectiveLimits(tenant);
  const usage = await getUsage(tenant.tenant_id);
  const period = getCurrentBillingPeriod();

  const result: EnforcementResult = { allowed: true, warnings: [], remaining: {} as Record<ResourceType, number> };

  const checks: Array<{ type: ResourceType; current: number; limit: number }> = [];

  if (resourceType === 'documents') {
    checks.push({ type: 'documents', current: usage.documents, limit: limits.docs_per_month });
  } else if (resourceType === 'tokens') {
    checks.push({ type: 'tokens', current: usage.tokens, limit: limits.tokens_per_month });
  } else if (resourceType === 'chats') {
    checks.push({ type: 'chats', current: usage.chats, limit: limits.chats_per_month });
  } else if (resourceType === 'workspaces') {
    const workspaces = await queryIndex<Workspace>(
      TABLE_NAMES.workspaces, 'tenant-index', 'tenant_id', tenant.tenant_id
    );
    checks.push({ type: 'workspaces', current: workspaces.length, limit: limits.workspaces });
  }

  for (const check of checks) {
    if (check.limit === Infinity) continue;

    const effectiveUsage = check.current + (requestedAmount ?? 1);

    // Hard limit check
    if (effectiveUsage > check.limit) {
      return {
        allowed: false,
        warnings: [],
        rejection: {
          resource_type: check.type,
          current_usage: check.current,
          limit: check.limit,
          billing_period: period,
          upgrade_url: '/v1/tenant/plan',
          message: `${check.type} limit reached. Current: ${check.current}, Limit: ${check.limit}. Upgrade your plan for higher limits.`,
        },
      };
    }

    // Soft limit check
    const softLimit = getSoftLimit(check.limit);
    if (check.current >= softLimit) {
      result.warnings.push({
        resource_type: check.type,
        current_usage: check.current,
        limit: check.limit,
        header_name: 'X-Usage-Warning',
        header_value: `${check.type}: ${check.current}/${check.limit} used`,
      });
    }

    result.remaining![check.type] = check.limit - check.current;
  }

  return result;
}

export function buildLimitResponse(rejection: EnforcementResult['rejection']): ApiResponse {
  return {
    statusCode: 429,
    body: {
      error: rejection!.message,
      resource_type: rejection!.resource_type,
      current_usage: rejection!.current_usage,
      limit: rejection!.limit,
      billing_period: rejection!.billing_period,
      upgrade_url: rejection!.upgrade_url,
    },
  };
}

export function buildWarningHeaders(result: EnforcementResult): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const warning of result.warnings) {
    headers[warning.header_name] = warning.header_value;
  }
  if (result.remaining) {
    const primary = Object.entries(result.remaining)[0];
    if (primary) {
      headers['X-Usage-Remaining'] = `${primary[0]}: ${primary[1]}`;
    }
  }
  return headers;
}

export async function routeEnforcement(
  method: string,
  path: string,
  tenant: Tenant,
  requestBody?: unknown
): Promise<EnforcementResult> {
  if (method === 'POST' && path === '/v1/workspaces') {
    return enforcePlanLimits(tenant, 'workspaces');
  }
  if (method === 'POST' && /^\/v1\/workspaces\/[^/]+\/process$/.test(path)) {
    return enforcePlanLimits(tenant, 'documents');
  }
  // G6-16: Batch processing route enforcement
  if (method === 'POST' && /^\/v1\/workspaces\/[^/]+\/process\/batch$/.test(path)) {
    const body = requestBody as { documents?: unknown[] } | null;
    const batchSize = body?.documents?.length ?? 1;
    // Batch counts as multiple document submissions — enforce against the full batch size
    return enforcePlanLimits(tenant, 'documents', batchSize);
  }
  if (method === 'POST' && /^\/v1\/sessions\/[^/]+\/chat$/.test(path)) {
    // T4-06: Check both chats (message count) and tokens (LLM spend) before invoking Bedrock.
    // Chats limit guards against excessive API calls; tokens limit caps LLM cost per billing period.
    const chatsResult = await enforcePlanLimits(tenant, 'chats');
    if (!chatsResult.allowed) return chatsResult;
    const tokensResult = await enforcePlanLimits(tenant, 'tokens');
    if (!tokensResult.allowed) return tokensResult;
    // Merge warnings from both checks
    return { ...chatsResult, warnings: [...chatsResult.warnings, ...tokensResult.warnings] };
  }
  return { allowed: true, warnings: [] };
}
