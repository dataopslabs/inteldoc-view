import { ulid } from 'ulid';
import { TABLE_NAMES, getItem, putItem, queryIndex, atomicIncrement } from './dynamo';
import type { UsageRecord, UsageEvent } from '../models/types';

export function getCurrentBillingPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getUsage(
  tenantId: string,
  billingPeriod?: string
): Promise<UsageRecord> {
  const period = billingPeriod ?? getCurrentBillingPeriod();
  const record = await getItem<UsageRecord>(TABLE_NAMES.usage, {
    tenant_id: tenantId,
    billing_period: period,
  });
  return record ?? {
    tenant_id: tenantId,
    billing_period: period,
    documents: 0,
    tokens: 0,
    chats: 0,
    updated_at: new Date().toISOString(),
  };
}

export async function incrementUsage(
  tenantId: string,
  field: 'documents' | 'tokens' | 'chats',
  amount: number
): Promise<void> {
  const period = getCurrentBillingPeriod();
  await atomicIncrement(
    TABLE_NAMES.usage,
    { tenant_id: tenantId, billing_period: period },
    field,
    amount
  );
}

export async function recordUsageEvent(
  tenantId: string,
  eventType: UsageEvent['event_type'],
  quantity: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  // expires_at: 1 year from now (Unix epoch seconds) — used by DynamoDB TTL
  const USAGE_EVENT_TTL_SECONDS = 365 * 24 * 3600;
  const event: UsageEvent = {
    event_id: ulid(),
    tenant_id: tenantId,
    event_type: eventType,
    quantity,
    billing_period: getCurrentBillingPeriod(),
    timestamp: new Date().toISOString(),
    metadata,
  };
  await putItem(TABLE_NAMES.usageEvents, {
    ...(event as unknown as Record<string, unknown>),
    expires_at: Math.floor(Date.now() / 1000) + USAGE_EVENT_TTL_SECONDS,
  });
}

export async function getUsageEvents(
  tenantId: string,
  billingPeriod: string
): Promise<UsageEvent[]> {
  const events = await queryIndex<UsageEvent>(
    TABLE_NAMES.usageEvents,
    'billing-period-index',
    'billing_period',
    billingPeriod
  );
  return events.filter((e) => e.tenant_id === tenantId);
}
