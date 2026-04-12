# G6-14 + G6-15: auditLog() + updated_at in workspace.ts

## File: `api/src/handlers/workspace.ts`

### 1. Add import at top (after existing imports):
```typescript
import { auditLog } from '../utils/audit';
```

### 2. In `handleCreateWorkspace` — add `updated_at` to the item and audit call:

Find the workspace item construction and add `updated_at`:
```typescript
const workspace: Workspace & { tenant_id: string } = {
  workspace_id: workspaceId,
  tenant_id: req.context.tenantId!,
  name,
  description: description ?? '',
  config: config ?? {},
  hitl_threshold: hitl_threshold ?? 0.8,
  agent_names: agent_names ?? [],
  prompt_version: prompt_version ?? '1.0.0',
  created_at: now,
  updated_at: now,   // ← ADD THIS
};
```

After `await putItem(TABLE_NAMES.workspaces, workspace)` add:
```typescript
await auditLog(req.context, 'workspace.created', {
  workspace_id: workspaceId,
  name,
  tenant_id: req.context.tenantId,
});
```

### 3. In `handleUpdateWorkspace` — add `updated_at` to UpdateExpression:

Replace the UpdateExpression in the update call:
```typescript
// OLD:
UpdateExpression: 'SET #name = :name, description = :desc, config = :cfg, hitl_threshold = :ht, agent_names = :an, prompt_version = :pv',

// NEW:
UpdateExpression: 'SET #name = :name, description = :desc, config = :cfg, hitl_threshold = :ht, agent_names = :an, prompt_version = :pv, updated_at = :ua',
```

Add `:ua` to ExpressionAttributeValues:
```typescript
// ADD to ExpressionAttributeValues:
':ua': new Date().toISOString(),
```

After the update call add:
```typescript
await auditLog(req.context, 'workspace.updated', {
  workspace_id,
  changes: { name, description, config, hitl_threshold, agent_names, prompt_version },
});
```

### 4. In `handleDeleteWorkspace` — add audit after soft-delete:

After the `updateItem` soft-delete call add:
```typescript
await auditLog(req.context, 'workspace.deleted', {
  workspace_id,
  tenant_id: req.context.tenantId,
});
```

### 5. Update `Workspace` type in `api/src/models/types.ts`:

```typescript
// In the Workspace interface, ensure updated_at exists:
export interface Workspace {
  workspace_id: string;
  tenant_id: string;
  name: string;
  description?: string;
  config?: Record<string, unknown>;
  hitl_threshold?: number;
  agent_names?: string[];
  prompt_version?: string;
  created_at: string;
  updated_at: string;  // ← ENSURE THIS EXISTS
  deleted?: boolean;
}
```
