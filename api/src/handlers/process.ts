import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { ApiRequest, ApiResponse, Workspace } from '../models/types';
import { getItem, putItem, TABLE_NAMES } from '../lib/dynamo';

const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET ?? '';
const PROCESSOR_FUNCTION_ARN = process.env.PROCESSOR_FUNCTION_ARN ?? '';

interface ProcessBody {
  filename: string;
  content_base64: string; // base64-encoded file bytes
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

  // Decode and upload to S3
  let fileBuffer: Buffer;
  try {
    fileBuffer = Buffer.from(body.content_base64, 'base64');
  } catch {
    return { statusCode: 400, body: { error: 'content_base64 is not valid base64' } };
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

  // Create trace record
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

  // Invoke processor Lambda asynchronously
  await lambda.send(
    new InvokeCommand({
      FunctionName: PROCESSOR_FUNCTION_ARN,
      InvocationType: 'Event', // async
      Payload: Buffer.from(
        JSON.stringify({
          trace_id: traceId,
          workspace_id: workspaceId,
          s3_key: s3Key,
          filename: body.filename,
          schema: workspace.schema ?? {},
          hitl_threshold: workspace.hitl_threshold,
          prompt_version: workspace.prompt_version,
        })
      ),
    })
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
