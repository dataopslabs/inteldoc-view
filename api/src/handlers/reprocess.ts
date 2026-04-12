/**
 * G5-25: Trace re-processing endpoint.
 * POST /v1/traces/:trace_id/reprocess
 *
 * Re-queues an existing failed or completed trace for reprocessing.
 * Useful for retrying failed traces or re-extracting with an updated schema.
 *
 * Only traces in status: 'failed' or 'completed' can be reprocessed.
 * A new trace_id is NOT created — the existing trace is updated in-place.
 */
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { ApiRequest, ApiResponse, Workspace } from '../models/types';
import { getItem, updateItem, TABLE_NAMES } from '../lib/dynamo';
import { invalidateMetricsCache } from './observability';

const lambda = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const PROCESSOR_FUNCTION_ARN = process.env.PROCESSOR_FUNCTION_ARN ?? '';

interface TraceRecord {
  trace_id: string;
  workspace_id: string;
  tenant_id: string;
  status: string;
  s3_key: string;
  filename: string;
  prompt_version: string;
  created_at: string;
}

export async function handleReprocessTrace(req: ApiRequest): Promise<ApiResponse> {
  const { trace_id: traceId } = req.pathParams;
  const tenant = req.context.tenant!;

  // Load trace
  const trace = await getItem<TraceRecord>(TABLE_NAMES.traces, { trace_id: traceId });
  if (!trace) {
    return { statusCode: 404, body: { error: 'Trace not found' } };
  }

  // Authorization: must belong to this tenant
  if (trace.tenant_id !== tenant.tenant_id) {
    return { statusCode: 403, body: { error: 'Forbidden' } };
  }

  // Only allow reprocessing of terminal states
  const reprocessableStatuses = ['failed', 'completed', 'hitl_required'];
  if (!reprocessableStatuses.includes(trace.status)) {
    return {
      statusCode: 409,
      body: {
        error: `Cannot reprocess trace in status '${trace.status}'. Only ${reprocessableStatuses.join(', ')} traces can be reprocessed.`,
      },
    };
  }

  // Load workspace to get latest schema and hitl_threshold
  const workspace = await getItem<Workspace>(TABLE_NAMES.workspaces, { workspace_id: trace.workspace_id });
  if (!workspace) {
    return { statusCode: 404, body: { error: 'Workspace not found' } };
  }

  // Reset trace to pending
  const now = new Date().toISOString();
  await updateItem(
    TABLE_NAMES.traces,
    { trace_id: traceId },
    'SET #status = :s, #updated = :now REMOVE #error, #error_code, #confidence, #tokens, #latency, #agent_steps, #fields',
    {
      '#status': 'status',
      '#updated': 'updated_at',
      '#error': 'error',
      '#error_code': 'error_code',
      '#confidence': 'confidence',
      '#tokens': 'tokens',
      '#latency': 'latency',
      '#agent_steps': 'agent_steps',
      '#fields': 'fields',
    },
    { ':s': 'pending', ':now': now }
  );

  // Re-invoke processor Lambda asynchronously
  await lambda.send(new InvokeCommand({
    FunctionName: PROCESSOR_FUNCTION_ARN,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({
      trace_id: traceId,
      workspace_id: trace.workspace_id,
      tenant_id: tenant.tenant_id,
      s3_key: trace.s3_key,
      filename: trace.filename,
      schema: workspace.schema ?? {},
      hitl_threshold: workspace.hitl_threshold,
      prompt_version: workspace.prompt_version,
    })),
  }));

  invalidateMetricsCache(tenant.tenant_id);

  return {
    statusCode: 202,
    body: {
      trace_id: traceId,
      status: 'pending',
      message: 'Trace re-queued for processing',
      reprocessed_at: now,
    },
  };
}
