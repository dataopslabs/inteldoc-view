/**
 * G5-12 + G6-02: Webhook management handlers.
 *
 * Tenants can register HTTPS endpoint URLs to receive real-time push notifications
 * when a trace transitions to a terminal state (completed | failed | hitl_required).
 *
 * Architecture:
 *   Processor Lambda ──► EventBridge (docops.trace.events) ──► Webhook Dispatcher Lambda
 *                                                                      │
 *                                                             HTTPS POST to tenant URLs
 *
 * G6-02: Signing secrets are stored in AWS Secrets Manager (NOT in DynamoDB plaintext).
 *   - On registration: secret created under path `docops/webhooks/<webhook_id>/signing_secret`
 *   - DynamoDB stores only `secret_arn` (the ARN reference, never the value)
 *   - Webhook Dispatcher reads the secret from Secrets Manager at dispatch time
 *   - On deletion: secret is deleted from Secrets Manager (with 7-day recovery window)
 *
 * Endpoints:
 *   POST   /v1/tenant/webhooks           — Register a webhook endpoint
 *   GET    /v1/tenant/webhooks           — List all registered webhooks
 *   DELETE /v1/tenant/webhooks/:id       — Deregister a webhook endpoint
 */
import { v4 as uuidv4 } from 'uuid';
import { SecretsManagerClient, CreateSecretCommand, DeleteSecretCommand } from '@aws-sdk/client-secrets-manager';
import { ApiRequest, ApiResponse } from '../models/types';
import { putItem, getItem, queryIndex, deleteItem } from '../lib/dynamo';
import { authMiddleware, requireRole } from '../middleware/auth';
import { auditLog } from '../lib/audit-logger';

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

const WEBHOOKS_TABLE = process.env.WEBHOOKS_TABLE ?? 'docops-webhooks';

// ── Types ─────────────────────────────────────────────────────────────────────

export type WebhookEvent = 'trace.completed' | 'trace.failed' | 'trace.hitl_required' | '*';

export interface WebhookRegistration {
  webhook_id: string;
  tenant_id: string;
  url: string;
  events: WebhookEvent[];
  /**
   * G6-02: signing_secret is NO LONGER stored here. The DDB record stores `secret_arn`
   * pointing to the AWS Secrets Manager secret. The signing_secret field is returned only
   * in the creation response (200 once, never again).
   */
  secret_arn?: string;
  description?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ── POST /v1/tenant/webhooks — Register a webhook ────────────────────────────

export async function handleRegisterWebhook(req: ApiRequest): Promise<ApiResponse> {
  const context = await authMiddleware(req.method, req.path, req.headers ?? {});
  if (!context) return { statusCode: 401, body: { error: 'Unauthorized' } };
  if (!requireRole(context, 'editor')) {
    return { statusCode: 403, body: { error: 'Forbidden', message: 'Editor role or higher required to manage webhooks' } };
  }

  const { tenantId, userId } = context;
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (!body.url || typeof body.url !== 'string') {
    return { statusCode: 400, body: { error: 'Bad Request', message: '"url" is required' } };
  }

  // Validate HTTPS URL (HTTP not accepted in production for security)
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(body.url);
  } catch {
    return { statusCode: 400, body: { error: 'Bad Request', message: '"url" must be a valid URL' } };
  }

  if (parsedUrl.protocol !== 'https:') {
    return { statusCode: 400, body: { error: 'Bad Request', message: '"url" must use HTTPS' } };
  }

  // Validate events array — default to all terminal state events
  const validEvents: WebhookEvent[] = ['trace.completed', 'trace.failed', 'trace.hitl_required', '*'];
  const requestedEvents: WebhookEvent[] = Array.isArray(body.events) ? body.events : ['trace.completed', 'trace.failed', 'trace.hitl_required'];
  for (const ev of requestedEvents) {
    if (!validEvents.includes(ev)) {
      return { statusCode: 400, body: { error: 'Bad Request', message: `Invalid event type: "${ev}". Valid values: ${validEvents.join(', ')}` } };
    }
  }

  // G6-02: Generate signing secret and store in AWS Secrets Manager (NOT DynamoDB).
  // The DDB record stores only the ARN so the Webhook Dispatcher can retrieve it at dispatch time.
  const signingSecret = `whsec_${uuidv4().replace(/-/g, '')}${uuidv4().replace(/-/g, '')}`;
  const webhookId = uuidv4();
  const now = new Date().toISOString();
  const secretName = `docops/webhooks/${webhookId}/signing_secret`;

  let secretArn: string;
  try {
    const createResult = await secretsClient.send(new CreateSecretCommand({
      Name: secretName,
      SecretString: signingSecret,
      Description: `Webhook signing secret for tenant ${tenantId}, webhook ${webhookId}`,
      Tags: [
        { Key: 'tenant_id', Value: tenantId },
        { Key: 'webhook_id', Value: webhookId },
        { Key: 'app', Value: 'docops' },
      ],
    }));
    secretArn = createResult.ARN!;
  } catch (err) {
    console.error('[webhooks] Failed to create Secrets Manager secret', { webhookId, error: String(err) });
    return { statusCode: 500, body: { error: 'Failed to provision webhook signing secret' } };
  }

  const registration: WebhookRegistration = {
    webhook_id: webhookId,
    tenant_id: tenantId,
    url: body.url,
    events: requestedEvents,
    secret_arn: secretArn,   // ARN reference only — value lives in Secrets Manager
    description: typeof body.description === 'string' ? body.description : undefined,
    active: true,
    created_at: now,
    updated_at: now,
  };

  await putItem(WEBHOOKS_TABLE, registration as unknown as Record<string, unknown>);

  await auditLog(tenantId, userId, 'workspace.created', {
    resourceId: webhookId,
    metadata: { url: body.url, events: requestedEvents, secret_arn: secretArn },
  });

  // Return signing_secret ONCE at creation — never exposed again after this response
  return {
    statusCode: 201,
    body: {
      webhook_id: webhookId,
      url: registration.url,
      events: registration.events,
      description: registration.description,
      active: registration.active,
      signing_secret: signingSecret, // ⚠️ Shown ONCE — copy and store securely
      created_at: registration.created_at,
    },
  };
}

// ── GET /v1/tenant/webhooks — List webhooks for tenant ────────────────────────

export async function handleListWebhooks(req: ApiRequest): Promise<ApiResponse> {
  const context = await authMiddleware(req.method, req.path, req.headers ?? {});
  if (!context) return { statusCode: 401, body: { error: 'Unauthorized' } };

  const { tenantId } = context;

  const results = await queryIndex(WEBHOOKS_TABLE, 'tenant-index', 'tenant_id', tenantId);

  // Never return signing_secret in list responses
  const webhooks = results.map((item) => {
    const { signing_secret: _secret, ...rest } = item as Record<string, unknown>;
    return rest;
  });

  return {
    statusCode: 200,
    body: { webhooks, count: webhooks.length },
  };
}

// ── DELETE /v1/tenant/webhooks/:id — Deregister a webhook ────────────────────

export async function handleDeleteWebhook(req: ApiRequest): Promise<ApiResponse> {
  const context = await authMiddleware(req.method, req.path, req.headers ?? {});
  if (!context) return { statusCode: 401, body: { error: 'Unauthorized' } };
  if (!requireRole(context, 'editor')) {
    return { statusCode: 403, body: { error: 'Forbidden', message: 'Editor role or higher required to manage webhooks' } };
  }

  const { tenantId, userId } = context;
  const webhookId = req.pathParams?.id;

  if (!webhookId) {
    return { statusCode: 400, body: { error: 'Bad Request', message: 'Missing webhook id' } };
  }

  // Fetch to verify ownership before deletion
  const existing = await getItem(WEBHOOKS_TABLE, { webhook_id: webhookId }) as WebhookRegistration | null;
  if (!existing) {
    return { statusCode: 404, body: { error: 'Not Found', message: 'Webhook not found' } };
  }
  if (existing.tenant_id !== tenantId) {
    return { statusCode: 403, body: { error: 'Forbidden', message: 'Webhook belongs to a different tenant' } };
  }

  await deleteItem(WEBHOOKS_TABLE, { webhook_id: webhookId });

  // G6-02: Delete the Secrets Manager secret (7-day recovery window for accidental deletion)
  if (existing.secret_arn) {
    try {
      await secretsClient.send(new DeleteSecretCommand({
        SecretId: existing.secret_arn,
        RecoveryWindowInDays: 7,
      }));
    } catch (err) {
      // Log but don't fail the deletion — the DDB record is already removed
      console.error('[webhooks] Failed to delete Secrets Manager secret', {
        webhookId,
        secret_arn: existing.secret_arn,
        error: String(err),
      });
    }
  }

  await auditLog(tenantId, userId, 'workspace.deleted', {
    resourceId: webhookId,
    metadata: { url: existing.url },
  });

  return { statusCode: 204, body: {} };
}
