# G6-14 + G6-24: auditLog() + EventBridge Notification in hitl.ts

## File: `api/src/handlers/hitl.ts`

### 1. Add imports at top:
```typescript
import { auditLog } from '../utils/audit';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
```

### 2. Create EventBridge client (module-level):
```typescript
const ebClient = new EventBridgeClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? 'docops-events';
```

### 3. In `handleAssignReview` — add EventBridge publish + audit:

After the DynamoDB update succeeds (review status → 'in_review'), add:
```typescript
// Publish EventBridge notification for reviewer assignment
try {
  await ebClient.send(new PutEventsCommand({
    Entries: [{
      EventBusName: EVENT_BUS_NAME,
      Source: 'docops.hitl',
      DetailType: 'HitlReviewAssigned',
      Detail: JSON.stringify({
        trace_id: traceId,
        workspace_id: review.workspace_id,
        reviewer: body.reviewer,
        assigned_at: new Date().toISOString(),
        tenant_id: req.context.tenantId,
      }),
      Time: new Date(),
    }],
  }));
} catch (ebErr) {
  console.error('EventBridge publish failed (non-fatal):', ebErr);
  // Non-fatal: continue even if notification fails
}

// Audit the assignment
await auditLog(req.context, 'hitl.review_assigned', {
  trace_id: traceId,
  reviewer: body.reviewer,
  workspace_id: review.workspace_id,
});
```

### 4. In `handleSubmitCorrections` — add audit:

After corrections are saved to DynamoDB:
```typescript
await auditLog(req.context, 'hitl.corrections_submitted', {
  trace_id: traceId,
  correction_count: corrections.length,
  workspace_id: review?.workspace_id,
});
```

### 5. In `handleResolveReview` (if it exists) — add audit:

After the review is resolved/approved:
```typescript
await auditLog(req.context, 'hitl.review_resolved', {
  trace_id: traceId,
  decision: body.decision,
  reviewer: req.context.userId,
});
```

### 6. Grant EventBridge permissions in IAM (infra/lib/api-stack.ts):

```typescript
// In the Lambda function's policies:
apiFunction.addToRolePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: ['events:PutEvents'],
  resources: [
    `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${EVENT_BUS_NAME}`,
  ],
}));
```

### 7. Create the EventBus in infra (if not already exists):

```typescript
// In api-stack.ts or a new events-stack.ts:
const eventBus = new events.EventBus(this, 'DocOpsEventBus', {
  eventBusName: 'docops-events',
});

// Allow Lambda to publish
eventBus.grantPutEventsTo(apiFunction);

// Optional: Archive events for 30 days
eventBus.archive('DocOpsArchive', {
  archiveName: 'docops-events-archive',
  retention: Duration.days(30),
  eventPattern: { source: ['docops.hitl', 'docops.workspace', 'docops.billing'] },
});

new CfnOutput(this, 'EventBusName', { value: eventBus.eventBusName });
```

### 8. Add ENV var to Lambda:

```typescript
// In Lambda env vars:
EVENT_BUS_NAME: eventBus.eventBusName,
```
