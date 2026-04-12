/**
 * G5-13: Bulk document upload endpoint.
 * POST /v1/workspaces/:id/process/batch
 *
 * Accepts up to 20 documents in a single request and fans them out to
 * the processor Lambda asynchronously. Returns a list of trace IDs.
 *
 * Request body:
 * {
 *   documents: Array<{
 *     filename: string;
 *     content_base64: string;
 *     idempotency_key?: string;
 *   }>
 * }
 */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { ApiRequest, ApiResponse, Workspace } from '../models/types';
import { getItem, putItem, TABLE_NAMES } from '../lib/dynamo';
import { incrementUsage, recordUsageEvent } from '../lib/usage-tracker';
import { invalidateMetricsCache } from './observability';

const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET ?? '';
const PROCESSOR_FUNCTION_ARN = process.env.PROCESSOR_FUNCTION_ARN ?? '';

const MAX_BATCH_SIZE = 20;
const MAX_BASE64_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILE_BYTES = 50 * 1024 * 1024;   // 50 MB decoded
const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg']);

interface BatchDocument {
  filename: string;
  content_base64: string;
  idempotency_key?: string;
}

interface BatchBody {
  documents: BatchDocument[];
}

export async function handleProcessBatch(req: ApiRequest): Promise<ApiResponse> {
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

  const body = req.body as BatchBody;
  if (!body?.documents || !Array.isArray(body.documents) || body.documents.length === 0) {
    return { statusCode: 400, body: { error: 'documents array is required and must be non-empty' } };
  }
  if (body.documents.length > MAX_BATCH_SIZE) {
    return {
      statusCode: 400,
      body: { error: `Batch size exceeds maximum of ${MAX_BATCH_SIZE} documents` },
    };
  }

  const now = new Date().toISOString();
  const results: Array<{ filename: string; trace_id: string; status: string; error?: string }> = [];

  for (const doc of body.documents) {
    if (!doc.filename || !doc.content_base64) {
      results.push({ filename: doc.filename ?? '(unknown)', trace_id: '', status: 'error', error: 'filename and content_base64 are required' });
      continue;
    }

    const ext = doc.filename.toLowerCase().split('.').pop() ?? '';
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      results.push({ filename: doc.filename, trace_id: '', status: 'error', error: `Unsupported file type '.${ext}'` });
      continue;
    }

    if (doc.content_base64.length > MAX_BASE64_BYTES) {
      results.push({ filename: doc.filename, trace_id: '', status: 'error', error: 'File payload too large' });
      continue;
    }

    let fileBuffer: Buffer;
    try {
      fileBuffer = Buffer.from(doc.content_base64, 'base64');
    } catch {
      results.push({ filename: doc.filename, trace_id: '', status: 'error', error: 'Invalid base64 content' });
      continue;
    }

    if (fileBuffer.length > MAX_FILE_BYTES) {
      results.push({ filename: doc.filename, trace_id: '', status: 'error', error: 'Decoded file too large' });
      continue;
    }

    // Check idempotency
    if (doc.idempotency_key) {
      const idemKey = `idempotent:${tenant.tenant_id}:${doc.idempotency_key}`;
      const existing = await getItem<{ trace_id: string; status: string }>(TABLE_NAMES.traces, { trace_id: idemKey });
      if (existing) {
        results.push({ filename: doc.filename, trace_id: existing.trace_id, status: 'duplicate' });
        continue;
      }
    }

    const traceId = uuidv4();
    const s3Key = `raw/${tenant.tenant_id}/${workspaceId}/${traceId}/${doc.filename}`;

    try {
      await s3.send(new PutObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: _mimeType(doc.filename),
      }));

      const trace = {
        trace_id: traceId,
        workspace_id: workspaceId,
        tenant_id: tenant.tenant_id,
        status: 'pending',
        s3_key: s3Key,
        filename: doc.filename,
        prompt_version: workspace.prompt_version,
        created_at: now,
      };
      await putItem(TABLE_NAMES.traces, trace as Record<string, unknown>);

      if (doc.idempotency_key) {
        const idemKey = `idempotent:${tenant.tenant_id}:${doc.idempotency_key}`;
        await putItem(TABLE_NAMES.traces, { trace_id: idemKey, trace_ref: traceId, status: 'pending', created_at: now });
      }

      await lambda.send(new InvokeCommand({
        FunctionName: PROCESSOR_FUNCTION_ARN,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({
          trace_id: traceId,
          workspace_id: workspaceId,
          tenant_id: tenant.tenant_id,
          s3_key: s3Key,
          filename: doc.filename,
          schema: workspace.schema ?? {},
          hitl_threshold: workspace.hitl_threshold,
          prompt_version: workspace.prompt_version,
        })),
      }));

      results.push({ filename: doc.filename, trace_id: traceId, status: 'pending' });
    } catch (err) {
      results.push({ filename: doc.filename, trace_id: traceId, status: 'error', error: String(err) });
    }
  }

  const accepted = results.filter((r) => r.status === 'pending').length;
  invalidateMetricsCache(tenant.tenant_id);

  if (accepted > 0) {
    incrementUsage(tenant.tenant_id, 'documents', accepted).catch(console.error);
    for (const r of results.filter((x) => x.status === 'pending')) {
      recordUsageEvent(tenant.tenant_id, 'document_processed', 1, {
        trace_id: r.trace_id,
        workspace_id: workspaceId,
      }).catch(console.error);
    }
  }

  return {
    statusCode: 202,
    body: {
      accepted,
      total: body.documents.length,
      results,
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
