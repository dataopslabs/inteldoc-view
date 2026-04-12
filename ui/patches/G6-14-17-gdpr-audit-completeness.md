# G6-14 + G6-17: auditLog() + GDPR Export Completeness in gdpr.ts

## File: `api/src/handlers/gdpr.ts`

### 1. Add imports at top:
```typescript
import { auditLog } from '../utils/audit';
import { queryIndex, scanTable } from '../utils/dynamodb';
import { TABLE_NAMES } from '../config/tables';
```

### 2. Fix `handleExportData` — add webhooks, usage_events, and audit:

Replace the existing export handler with:
```typescript
export async function handleExportData(req: ApiRequest): Promise<ApiResponse> {
  requireRole(req.context, 'viewer');
  const tenantId = req.context.tenantId!;

  // Fetch all data in parallel
  const [workspaces, sessions, webhooks, usageEvents] = await Promise.all([
    queryIndex(TABLE_NAMES.workspaces, 'tenant-id-index', 'tenant_id', tenantId),
    queryIndex(TABLE_NAMES.sessions, 'tenant-id-index', 'tenant_id', tenantId),
    queryIndex(TABLE_NAMES.webhooks, 'tenant-id-index', 'tenant_id', tenantId),
    queryIndex(TABLE_NAMES.usageEvents, 'tenant-id-index', 'tenant_id', tenantId).catch(() => []),
  ]);

  // Fetch traces for each workspace
  const tracePromises = (workspaces as Array<{ workspace_id: string }>).map(ws =>
    queryIndex(TABLE_NAMES.traces, 'workspace-id-index', 'workspace_id', ws.workspace_id),
  );
  const traceArrays = await Promise.all(tracePromises);
  const traces = traceArrays.flat();

  const exportData = {
    export_timestamp: new Date().toISOString(),
    tenant: { tenant_id: tenantId },
    data: {
      counts: {
        workspaces: (workspaces as unknown[]).length,
        traces: traces.length,
        sessions: (sessions as unknown[]).length,
        webhooks: (webhooks as unknown[]).length,
        usage_events: (usageEvents as unknown[]).length,
      },
      workspaces,
      traces,
      sessions,
      webhooks,
      usage_events: usageEvents,
    },
  };

  // Audit the export
  await auditLog(req.context, 'gdpr.data_exported', {
    tenant_id: tenantId,
    counts: exportData.data.counts,
  });

  return { statusCode: 200, body: exportData };
}
```

### 3. Fix `handleDeleteAccount` — add audit before deletion:

In `handleDeleteAccount`, before or at the start of the deletion process:
```typescript
// Audit FIRST before deleting (so audit record survives)
await auditLog(req.context, 'gdpr.tenant_deleted', {
  tenant_id: tenantId,
  deleted_at: new Date().toISOString(),
  requested_by: req.context.userId,
}).catch(() => {}); // best-effort: don't block deletion if audit fails
```

### 4. DynamoDB table name constants needed:

Ensure `TABLE_NAMES` in `api/src/config/tables.ts` includes:
```typescript
export const TABLE_NAMES = {
  // ... existing ...
  webhooks: process.env.WEBHOOKS_TABLE ?? 'docops-webhooks',
  usageEvents: process.env.USAGE_EVENTS_TABLE ?? 'docops-usage-events',
  // ...
};
```

### 5. Add GSI to webhooks table for tenant lookup:

In `infra/lib/api-stack.ts` (or wherever the webhooks table is defined), add GSI:
```typescript
webhooksTable.addGlobalSecondaryIndex({
  indexName: 'tenant-id-index',
  partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
```
