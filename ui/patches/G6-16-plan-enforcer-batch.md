# G6-16: Batch Route Plan Enforcement in plan-enforcer.ts

## File: `api/src/middleware/plan-enforcer.ts`

### Problem
The batch document upload route `POST /v1/workspaces/:id/process/batch` is not
covered in `routeEnforcement()`, so plan limits (docs_per_month, tokens_per_month)
are bypassed for batch submissions.

### Fix: Add batch route to routeEnforcement()

Find the `routeEnforcement` function and add batch handling:

```typescript
// In routeEnforcement(), add to the route matching section:

// Batch processing route
if (method === 'POST' && path.match(/^\/v1\/workspaces\/[^/]+\/process\/batch$/)) {
  const body = req.body as { documents?: unknown[] } | null;
  const batchSize = body?.documents?.length ?? 0;

  // Check if plan allows batch processing (only pro/enterprise)
  if (plan === 'free' || plan === 'starter') {
    return buildLimitResponse('batch_processing', {
      current_plan: plan,
      required_plan: 'pro',
      message: 'Batch processing requires a Pro or Enterprise plan',
    });
  }

  // Check remaining doc quota for the entire batch
  const docsRemaining = limits.docs_per_month - usage.documents;
  if (batchSize > docsRemaining) {
    return buildLimitResponse('monthly_documents', {
      limit: limits.docs_per_month,
      used: usage.documents,
      requested: batchSize,
      remaining: Math.max(0, docsRemaining),
      message: `Batch of ${batchSize} exceeds remaining monthly quota of ${docsRemaining} documents`,
    });
  }

  return null; // allow
}
```

### Updated PLAN_LIMITS for batch:

```typescript
export const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    workspaces: 1,
    docs_per_month: 50,
    tokens_per_month: 100_000,
    chats_per_month: 100,
    batch_processing: false,   // ← ADD
    max_batch_size: 0,          // ← ADD
  },
  starter: {
    workspaces: 3,
    docs_per_month: 500,
    tokens_per_month: 2_000_000,
    chats_per_month: 1_000,
    batch_processing: false,   // ← ADD
    max_batch_size: 0,          // ← ADD
  },
  pro: {
    workspaces: 20,
    docs_per_month: 5_000,
    tokens_per_month: 20_000_000,
    chats_per_month: 10_000,
    batch_processing: true,    // ← ADD
    max_batch_size: 50,         // ← ADD
  },
  enterprise: {
    workspaces: -1,  // unlimited
    docs_per_month: -1,
    tokens_per_month: -1,
    chats_per_month: -1,
    batch_processing: true,    // ← ADD
    max_batch_size: 500,        // ← ADD
  },
};
```

### Update PlanLimits type:

```typescript
export interface PlanLimits {
  workspaces: number;
  docs_per_month: number;
  tokens_per_month: number;
  chats_per_month: number;
  batch_processing: boolean;   // ← ADD
  max_batch_size: number;      // ← ADD
}
```

### Add per-upload rate limit (document upload routes):

```typescript
// In routeEnforcement(), for single document upload:
if (method === 'POST' && path.match(/^\/v1\/workspaces\/[^/]+\/process$/)) {
  const docsRemaining = limits.docs_per_month - usage.documents;
  if (limits.docs_per_month !== -1 && usage.documents >= limits.docs_per_month) {
    return buildLimitResponse('monthly_documents', {
      limit: limits.docs_per_month,
      used: usage.documents,
      remaining: 0,
    });
  }
  return null;
}
```
