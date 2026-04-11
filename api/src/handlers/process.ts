import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { ApiRequest, ApiResponse, Workspace } from '../models/types';
import { getItem, putItem, TABLE_NAMES } from '../lib/dynamo';
import { incrementUsage, recordUsageEvent } from '../lib/usage-tracker';
import { invalidateMetricsCache } from './observability';

const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET ?? '';
const PROCESSOR_FUNCTION_ARN = process.env.PROCESSOR_FUNCTION_ARN ?? '';

// 10 MB base64-encoded payload cap (before decoding)
const MAX_BASE64_BYTES = 10 * 1024 * 1024;
// 50 MB decoded file cap
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg']);

// Validated schema: flat object with string type annotations only
const ALLOWED_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'date', 'any']);
const MAX_SCHEMA_FIELDS = 50;
const MAX_SCHEMA_BYTES = 50 * 1024; // 50 KB

function validateSchema(schema: unknown): string | null {
  if (schema === undefined || schema === null) return null;
  if (typeof schema === 'object' && !Array.isArray(schema) && Object.keys(schema as object).length === 0) {
    return null; // empty schema — skip LLM, Docling-only mode
  }
  if (typeof schema !== 'object' || Array.isArray(schema)) {
    return 'schema must be a JSON object';
  }
  const entries = Object.entries(schema as Record<string, unknown>);
  if (entries.length > MAX_SCHEMA_FIELDS) {
    return `schema cannot exceed ${MAX_SCHEMA_FIELDS} fields`;
  }
  if (JSON.stringify(schema).length > MAX_SCHEMA_BYTES) {
    return `schema exceeds maximum size of ${MAX_SCHEMA_BYTES / 1024}KB`;
  }
  for (const [key, val] of entries) {
    if (typeof key !== 'string' || key.trim() === '') {
      return 'schema field keys must be non-empty strings';
    }
    if (typeof val !== 'string' || !ALLOWED_SCHEMA_TYPES.has(val as string)) {
      return `schema field '${key}' has invalid type '${val}'. Allowed: ${[...ALLOWED_SCHEMA_TYPES].join(', ')}`;
    }
  }
  return null;
}

interface ProcessBody {
  filename: string;
  content_base64: string; // base64-encoded file bytes
  idempotency_key?: string; // optional client-supplied deduplication key
}

export async function handleProcessDocument(req: ApiRequest): Promise<ApiResponse> {
  const { id: workspaceId } = req.pathParams;
  const tenant = req.context.tenant!;

  // Load workspace
  const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: workspaceId });
  if (!workspace) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }
  if (workspace.tenant_id !== tenant.tenant_id) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }

  const body = req.body as ProcessBody;
  if (!body?.filename || !body?.content_base64) {
    return { statusCode: 400, body: { error: 'filename and content_base64 are required' } };
  }

  // File extension validation — reject unsupported types before any processing
  const ext = body.filename.toLowerCase().split('.').pop() ?? '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      statusCode: 400,
      body: { error: `Unsupported file type '.${ext}'. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` },
    };
  }

  // Payload size gate — cheap check before base64 decode
  if (body.content_base64.length > MAX_BASE64_BYTES) {
    return {
      statusCode: 413,
      body: { error: `File payload exceeds maximum of ${MAX_BASE64_BYTES / 1024 / 1024}MB` },
    };
  }

  // Validate workspace schema structure before spinning up processor
  const schemaError = validateSchema(workspace.schema);
  if (schemaError) {
    return { statusCode: 422, body: { error: `Workspace schema invalid: ${schemaError}` } };
  }

  // Idempotency — return cached result for duplicate submissions
  if (body.idempotency_key) {
    const idemKey = `idempotent:${tenant.tenant_id}:${body.idempotency_key}`;
    const existing = await getItem<{ trace_id: string; status: string }>(
      TABLE_NAMES.traces,
      { trace_id: idemKey }
    );
    if (existing) {
      return {
        statusCode: 200,
        body: {
          trace_id: existing.trace_id,
          status: existing.status,
          message: 'Duplicate request — returning existing trace',
        },
      };
    }
  }

  // Decode base64 → raw bytes
  let fileBuffer: Buffer;
  try {
    fileBuffer = Buffer.from(body.content_base64, 'base64');
  } catch {
    return { statusCode: 400, body: { error: 'content_base64 is not valid base64' } };
  }

  // Decoded file size check
  if (fileBuffer.length > MAX_FILE_BYTES) {
    return {
      statusCode: 413,
      body: { error: `Decoded file exceeds maximum of ${MAX_FILE_BYTES / 1024 / 1024}MB` },
    };
  }

  const traceId = uuidv4();
  const s3Key = `raw/${tenant.tenant_id}/${workspaceId}/${traceId}/${body.filename}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: _mimeType(body.filename),
    })
  );

  // Create trace record — tenant_id written at creation for security isolation (G5-19)
  const now = new Date().toISOString();
  const trace = {
    trace_id: traceId,
    workspace_id: workspaceId,
    tenant_id: tenant.tenant_id,
    status: 'pending',
    s3_key: s3Key,
    filename: body.filename,
    prompt_version: workspace.prompt_version,
    created_at: now,
  };
  await putItem(TABLE_NAMES.traces, trace as Record<string, unknown>);

  // Store idempotency key pointing to the new trace
  if (body.idempotency_key) {
    const idemKey = `idempotent:${tenant.tenant_id}:${body.idempotency_key}`;
    await putItem(TABLE_NAMES.traces, {
      trace_id: idemKey,
      trace_ref: traceId,
      status: 'pending',
      created_at: now,
    });
  }

  // Invoke processor Lambda asynchronously
  await lambda.send(
    new InvokeCommand({
      FunctionName: PROCESSOR_FUNCTION_ARN,
      InvocationType: 'Event', // async — fire and forget
      Payload: Buffer.from(
        JSON.stringify({
          trace_id: traceId,
          workspace_id: workspaceId,
          tenant_id: tenant.tenant_id,
          s3_key: s3Key,
          filename: body.filename,
          schema: workspace.schema ?? {},
          hitl_threshold: workspace.hitl_threshold,
          prompt_version: workspace.prompt_version,
        })
      ),
    })
  );

  // T4-03: Invalidate metrics cache for this tenant — new trace affects usage dashboards
  invalidateMetricsCache(tenant.tenant_id);

  // Track document usage — wrapped individually to avoid blocking response
  incrementUsage(tenant.tenant_id, 'documents', 1).catch((err) =>
    console.error('[usage] increment failed', { tenant_id: tenant.tenant_id, error: String(err) })
  );
  recordUsageEvent(tenant.tenant_id, 'document_processed', 1, {
    trace_id: traceId,
    workspace_id: workspaceId,
  }).catch((err) =>
    console.error('[usage] event record failed', { tenant_id: tenant.tenant_id, error: String(err) })
  );

  return {
    statusCode: 202,
    body: {
      trace_id: traceId,
      status: 'pending',
      message: 'Document submitted for processing',
    },
  };
}

function _mimeType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  return map[ext] ?? 'application/octet-stream';
}

/**
 * G6-22: POST /v1/workspaces/:id/upload-url
 * Returns a presigned S3 PUT URL for direct large-file uploads that bypass
 * the 10 MB API Gateway payload limit. The client uploads the file directly
 * to S3 using the signed URL, then calls the normal process endpoint with
 * the returned s3_key instead of content_base64.
 *
 * Body: { filename: string }
 * Response: { upload_url: string, s3_key: string, expires_in: number }
 */
export async function handleGetUploadUrl(req: ApiRequest): Promise<ApiResponse> {
  const { id: workspaceId } = req.pathParams;
  const tenant = req.context.tenant!;

  const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: workspaceId });
  if (!workspace) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }
  if (workspace.tenant_id !== tenant.tenant_id) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }

  const body = req.body as { filename?: string } | null;
  if (!body?.filename) {
    return { statusCode: 400, body: { error: 'filename is required' } };
  }

  const ext = body.filename.toLowerCase().split('.').pop() ?? '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      statusCode: 400,
      body: { error: `Unsupported file type '.${ext}'. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` },
    };
  }

  const uploadId = uuidv4();
  const s3Key = `uploads/${tenant.tenant_id}/${workspaceId}/${uploadId}/${body.filename}`;
  const EXPIRES_IN_SECONDS = 900; // 15 minutes

  const command = new PutObjectCommand({
    Bucket: DOCUMENTS_BUCKET,
    Key: s3Key,
    ContentType: _mimeType(body.filename),
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: EXPIRES_IN_SECONDS });

  return {
    statusCode: 200,
    body: {
      upload_url: uploadUrl,
      s3_key: s3Key,
      expires_in: EXPIRES_IN_SECONDS,
      workspace_id: workspaceId,
    },
  };
}
