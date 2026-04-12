# G6-14: auditLog() in billing.ts

## File: `api/src/handlers/billing.ts`

### 1. Add import at top (after existing imports):
```typescript
import { auditLog } from '../utils/audit';
```

### 2. In `handleChangePlan` — add audit after successful plan change:

Find the section where the plan change is written to DynamoDB and add after it:
```typescript
await auditLog(req.context, 'plan.changed', {
  previous_plan: currentPlan,
  new_plan: plan,
  tenant_id: req.context.tenantId,
  upgrade: PLAN_ORDER.indexOf(plan) > PLAN_ORDER.indexOf(currentPlan),
  effective_at: downgrade_at ?? new Date().toISOString(),
});
```

### 3. In `handleExportUsage` — add audit after successful query:

After the usage events are fetched and before the response is returned:
```typescript
await auditLog(req.context, 'usage.exported', {
  billing_period: billingPeriod,
  event_count: events.length,
  tenant_id: req.context.tenantId,
});
```

### 4. In `handleGetPlan` — no audit needed (read-only).

### Complete diff summary:
```typescript
// In handleChangePlan, after updating DynamoDB tenant record:
await auditLog(req.context, 'plan.changed', {
  previous_plan: tenant.plan,
  new_plan: plan,
  tenant_id: req.context.tenantId,
  upgrade: PLAN_ORDER.indexOf(plan) > PLAN_ORDER.indexOf(tenant.plan),
});

// In handleExportUsage, after querying usage events:
await auditLog(req.context, 'usage.exported', {
  billing_period: billingPeriod,
  event_count: (events ?? []).length,
  tenant_id: req.context.tenantId,
});
```
