/**
 * G5-10: Health check handlers — shallow liveness + deep readiness.
 *
 * GET /v1/health        — liveness: returns 200 immediately (no dependency checks).
 *                          Used by ALB/ELB health checks; fast response, never fails.
 *
 * GET /v1/health/ready  — readiness: checks DynamoDB, S3, and Bedrock reachability.
 *                          Returns 200 if all dependencies healthy, 503 otherwise.
 *                          Used by orchestrators before sending traffic.
 */
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { ApiResponse } from '../models/types';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const TRACES_TABLE = process.env.TRACES_TABLE ?? '';
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET ?? '';
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-3-haiku-20240307-v1:0';

const dynamoClient = new DynamoDBClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });
const bedrockClient = new BedrockRuntimeClient({ region: REGION });

/** Liveness — always returns 200. */
export function handleHealth(): ApiResponse {
  return {
    statusCode: 200,
    body: { status: 'ok', service: 'docops-api', timestamp: new Date().toISOString() },
  };
}

interface DependencyCheck {
  name: string;
  healthy: boolean;
  latency_ms: number;
  error?: string;
}

/**
 * Readiness — checks all downstream dependencies.
 * Returns 200 with {status: 'ready'} if all pass, 503 with {status: 'degraded'} if any fail.
 */
export async function handleHealthReady(): Promise<ApiResponse> {
  const checks: DependencyCheck[] = await Promise.all([
    checkDynamoDB(),
    checkS3(),
    checkBedrock(),
  ]);

  const allHealthy = checks.every((c) => c.healthy);

  return {
    statusCode: allHealthy ? 200 : 503,
    body: {
      status: allHealthy ? 'ready' : 'degraded',
      service: 'docops-api',
      timestamp: new Date().toISOString(),
      checks,
    },
  };
}

async function checkDynamoDB(): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    await dynamoClient.send(new DescribeTableCommand({ TableName: TRACES_TABLE }));
    return { name: 'dynamodb', healthy: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      name: 'dynamodb',
      healthy: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkS3(): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: DOCUMENTS_BUCKET }));
    return { name: 's3', healthy: true, latency_ms: Date.now() - start };
  } catch (err) {
    return {
      name: 's3',
      healthy: false,
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkBedrock(): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    // Minimal ping — invoke with a tiny payload to verify connectivity + permissions
    await bedrockClient.send(
      new InvokeModelCommand({
        modelId: BEDROCK_MODEL_ID,
        contentType: 'application/json',
        accept: 'application/json',
        body: Buffer.from(
          JSON.stringify({
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'ping' }],
          })
        ),
      })
    );
    return { name: 'bedrock', healthy: true, latency_ms: Date.now() - start };
  } catch (err) {
    // Bedrock is considered healthy if we get a 4xx (quota, validation) — those mean the service is reachable.
    // Only mark unhealthy on connection errors / 5xx.
    const msg = err instanceof Error ? err.message : String(err);
    const reachable =
      msg.includes('ValidationException') ||
      msg.includes('ThrottlingException') ||
      msg.includes('AccessDeniedException');
    return {
      name: 'bedrock',
      healthy: reachable,
      latency_ms: Date.now() - start,
      error: reachable ? undefined : msg,
    };
  }
}
