import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaDestinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import * as path from 'path';

interface ProcessingStackProps extends cdk.StackProps {
  tracesTable: dynamodb.Table;
  workspacesTable: dynamodb.Table;
  doclingServiceUrl: string;
  // G5-09: Pass KMS key from DatabaseStack so S3 uses same key hierarchy
  tableEncryptionKey?: kms.Key;
  // G5-12: Webhooks registrations table for the webhook dispatcher Lambda
  webhooksTable?: dynamodb.Table;
}

export class ProcessingStack extends cdk.Stack {
  public readonly documentsBucket: s3.Bucket;
  public readonly processorFunction: lambda.Function;
  // T4-05: Shared SNS topic for operational alerts — exported so ApiStack can reuse it
  public readonly alertTopic: sns.Topic;
  // G5-12: Custom EventBridge event bus for trace lifecycle events
  public readonly traceEventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, props);

    const { tracesTable, workspacesTable, doclingServiceUrl, tableEncryptionKey, webhooksTable } = props;

    // T4-05: SNS topic for all CloudWatch alarm notifications
    this.alertTopic = new sns.Topic(this, 'DocOpsAlertTopic', {
      topicName: 'docops-ops-alerts',
      displayName: 'DocOps Operational Alerts',
    });

    // T4-01: SQS Dead-Letter Queue for processor Lambda async invocation failures.
    const processorDlq = new sqs.Queue(this, 'ProcessorDlq', {
      queueName: 'docops-processor-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // G5-09: S3 customer-managed KMS encryption.
    // Reuse the DynamoDB key from DatabaseStack for unified key management,
    // or create a dedicated S3 key if not provided.
    const s3EncryptionKey = tableEncryptionKey ?? new kms.Key(this, 'S3EncryptionKey', {
      alias: 'docops/s3',
      description: 'DocOps — customer-managed key for S3 document bucket encryption',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // S3 bucket for document uploads — G5-09: KMS customer-managed encryption
    this.documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: `docops-documents-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: s3EncryptionKey,
      bucketKeyEnabled: true, // Reduces KMS API costs by caching data key at bucket level
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'expire-raw-uploads',
          prefix: 'raw/',
          expiration: cdk.Duration.days(30),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['http://localhost:3000', 'https://docops.dataopslabs.com'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // G5-11: Store DOCLING_SERVICE_URL in SSM Parameter Store for auditability + rotation.
    const doclingUrlParam = new ssm.StringParameter(this, 'DoclingServiceUrlParam', {
      parameterName: '/docops/docling-service-url',
      stringValue: doclingServiceUrl || 'http://localhost:5001',
      description: 'DocOps — Docling ECS service URL for the processor Lambda',
    });

    // Python processor Lambda (Phase 2 — document processing pipeline)
    // Dependencies are pre-installed in services/processor/ — skip Docker bundling.
    const servicesDir = path.resolve(__dirname, '..', '..', 'services');
    this.processorFunction = new lambda.Function(this, 'ProcessorFunction', {
      functionName: 'docops-processor',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(`${servicesDir}/processor`, {
        exclude: ['**/__pycache__', '**/*.pyc', 'tests/**'],
      }),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(120),
      environment: {
        TRACES_TABLE: tracesTable.tableName,
        WORKSPACES_TABLE: workspacesTable.tableName,
        DOCUMENTS_BUCKET: this.documentsBucket.bucketName,
        DOCLING_SERVICE_URL: doclingServiceUrl,
        BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
        AWS_REGION_NAME: this.region,
        // G5-12: Custom EventBridge bus name for trace lifecycle events
        TRACE_EVENT_BUS_NAME: 'docops-trace-events',
      },
      reservedConcurrentExecutions: 20,
      onFailure: new lambdaDestinations.SqsDestination(processorDlq),
      // G5-01: Enable AWS X-Ray active tracing on the processor Lambda
      tracing: lambda.Tracing.ACTIVE,
    });

    // Permissions
    tracesTable.grantReadWriteData(this.processorFunction);
    workspacesTable.grantReadData(this.processorFunction);
    this.documentsBucket.grantReadWrite(this.processorFunction);
    // G5-11: Grant SSM read for config parameters
    doclingUrlParam.grantRead(this.processorFunction);

    // Bedrock invoke permission
    this.processorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
        ],
      })
    );

    // ── G5-28: Stale trace cleanup Lambda + EventBridge cron ──────────────────
    // Marks traces stuck in 'processing' status for > 10 min as failed with STALE_TIMEOUT code.
    // Prevents zombie traces from clogging dashboards and HITL queues.
    const cleanupFunction = new lambda.Function(this, 'StaleTraceCleanupFunction', {
      functionName: 'docops-stale-trace-cleanup',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const TRACES_TABLE = process.env.TRACES_TABLE;
const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

exports.handler = async () => {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
  const result = await docClient.send(new ScanCommand({
    TableName: TRACES_TABLE,
    FilterExpression: '#s = :processing AND #created <= :cutoff',
    ExpressionAttributeNames: { '#s': 'status', '#created': 'created_at' },
    ExpressionAttributeValues: { ':processing': 'processing', ':cutoff': cutoff },
  }));
  const staleTraces = result.Items ?? [];
  console.log(JSON.stringify({ message: 'Stale trace cleanup', count: staleTraces.length, cutoff }));
  for (const trace of staleTraces) {
    await docClient.send(new UpdateCommand({
      TableName: TRACES_TABLE,
      Key: { trace_id: trace.trace_id },
      UpdateExpression: 'SET #s = :failed, #ec = :code, #err = :msg, #ua = :now',
      ExpressionAttributeNames: { '#s': 'status', '#ec': 'error_code', '#err': 'error', '#ua': 'updated_at' },
      ExpressionAttributeValues: {
        ':failed': 'failed',
        ':code': 'STALE_TIMEOUT',
        ':msg': 'Trace exceeded maximum processing time and was automatically failed',
        ':now': new Date().toISOString(),
      },
    }));
  }
  return { cleaned: staleTraces.length };
};
      `),
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      environment: {
        TRACES_TABLE: tracesTable.tableName,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      tracing: lambda.Tracing.ACTIVE, // G5-01
    });
    tracesTable.grantReadWriteData(cleanupFunction);

    // EventBridge rule — every 5 minutes
    const cleanupRule = new events.Rule(this, 'StaleTraceCleanupRule', {
      ruleName: 'docops-stale-trace-cleanup',
      description: 'Run stale trace cleanup every 5 minutes to fail zombie processing traces',
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
    });
    cleanupRule.addTarget(new targets.LambdaFunction(cleanupFunction));

    // ── T4-05: CloudWatch Alarms ────────────────────────────────────────────

    const processorErrorAlarm = new cloudwatch.Alarm(this, 'ProcessorErrorAlarm', {
      alarmName: 'docops-processor-errors',
      alarmDescription: 'Processor Lambda error rate is elevated',
      metric: this.processorFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    processorErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
    processorErrorAlarm.addOkAction(new cloudwatchActions.SnsAction(this.alertTopic));

    const dlqDepthAlarm = new cloudwatch.Alarm(this, 'ProcessorDlqDepthAlarm', {
      alarmName: 'docops-processor-dlq-depth',
      alarmDescription: 'Messages are accumulating in the Processor DLQ — investigate failed events',
      metric: processorDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: 'Maximum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqDepthAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));

    const processorThrottleAlarm = new cloudwatch.Alarm(this, 'ProcessorThrottleAlarm', {
      alarmName: 'docops-processor-throttles',
      alarmDescription: 'Processor Lambda is being throttled — consider raising reserved concurrency',
      metric: this.processorFunction.metricThrottles({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    processorThrottleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));

    // ── G5-12: EventBridge custom bus + Webhook Dispatcher ───────────────────
    // Processor Lambda publishes trace lifecycle events to this custom bus.
    // The WebhookDispatcher Lambda consumes them and fans out to registered tenant URLs.
    //
    // Event schema (published by handler.py after each terminal status update):
    // {
    //   "source":      "docops.processor",
    //   "detail-type": "TraceStatusChanged",
    //   "detail": {
    //     "trace_id":    "...",
    //     "tenant_id":   "...",
    //     "workspace_id":"...",
    //     "status":      "completed" | "failed" | "hitl_required",
    //     "error_code":  "..." | null
    //   }
    // }
    this.traceEventBus = new events.EventBus(this, 'TraceEventBus', {
      eventBusName: 'docops-trace-events',
    });

    // Allow the processor Lambda to publish events to the custom bus
    this.traceEventBus.grantPutEventsTo(this.processorFunction);

    // Webhook Dispatcher Lambda — receives trace events and HTTP POSTs to registered webhooks
    const webhookDispatcher = new lambda.Function(this, 'WebhookDispatcherFunction', {
      functionName: 'docops-webhook-dispatcher',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const https = require('https');
const crypto = require('crypto');

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);
const WEBHOOKS_TABLE = process.env.WEBHOOKS_TABLE;

/**
 * Build HMAC-SHA256 signature for webhook delivery.
 * Header sent: X-DocOps-Signature-256: sha256=<hex>
 * Consumers should verify: crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
 */
function sign(secret, payload) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** POST payload to a single webhook URL, returns true if 2xx response. */
async function deliver(url, body, signingSecret) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const sig = sign(signingSecret, payload);
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-DocOps-Signature-256': sig,
        'X-DocOps-Event': body.event,
        'User-Agent': 'DocOps-Webhooks/1.0',
      },
      timeout: 10000,
    }, (res) => {
      // Drain the response body to free the socket
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  const detail = event.detail ?? {};
  const { trace_id, tenant_id, workspace_id, status, error_code } = detail;

  if (!tenant_id) {
    console.warn(JSON.stringify({ message: 'Missing tenant_id in event detail', event }));
    return;
  }

  // Fetch all webhook registrations for this tenant
  let registrations = [];
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: WEBHOOKS_TABLE,
      IndexName: 'tenant-index',
      KeyConditionExpression: 'tenant_id = :tid',
      ExpressionAttributeValues: { ':tid': tenant_id },
      FilterExpression: '#a = :true',
      ExpressionAttributeNames: { '#a': 'active' },
    }));
    registrations = result.Items ?? [];
  } catch (err) {
    console.error(JSON.stringify({ message: 'Failed to query webhooks', tenant_id, error: String(err) }));
    return;
  }

  if (registrations.length === 0) return;

  // Map EventBridge detail-type status → webhook event name
  const eventName = 'trace.' + status; // e.g. trace.completed, trace.failed, trace.hitl_required

  const webhookPayload = {
    event: eventName,
    trace_id,
    tenant_id,
    workspace_id,
    status,
    error_code: error_code ?? null,
    timestamp: new Date().toISOString(),
  };

  // Fan-out delivery — fire all matching webhooks concurrently
  const deliveries = registrations
    .filter(reg => reg.events.includes('*') || reg.events.includes(eventName))
    .map(async (reg) => {
      const ok = await deliver(reg.url, webhookPayload, reg.signing_secret);
      console.log(JSON.stringify({
        message: ok ? 'Webhook delivered' : 'Webhook delivery failed',
        webhook_id: reg.webhook_id,
        url: reg.url,
        event: eventName,
        trace_id,
      }));
    });

  await Promise.allSettled(deliveries);
};
      `),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      environment: {
        WEBHOOKS_TABLE: webhooksTable?.tableName ?? 'docops-webhooks',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      // G5-01: X-Ray tracing
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant dispatcher read access to webhook registrations table
    if (webhooksTable) {
      webhooksTable.grantReadData(webhookDispatcher);
    }

    // EventBridge rule — invoke dispatcher on all terminal trace status changes
    const traceEventRule = new events.Rule(this, 'TraceStatusChangedRule', {
      ruleName: 'docops-trace-status-changed',
      description: 'Route terminal trace status events (completed/failed/hitl_required) to webhook dispatcher',
      eventBus: this.traceEventBus,
      eventPattern: {
        source: ['docops.processor'],
        detailType: ['TraceStatusChanged'],
        detail: {
          status: ['completed', 'failed', 'hitl_required'],
        },
      },
    });
    traceEventRule.addTarget(new targets.LambdaFunction(webhookDispatcher, {
      // Up to 2 retries with exponential back-off on Lambda invocation failure
      retryAttempts: 2,
    }));

    // Outputs
    new cdk.CfnOutput(this, 'DocumentsBucketName', { value: this.documentsBucket.bucketName });
    new cdk.CfnOutput(this, 'ProcessorFunctionArn', { value: this.processorFunction.functionArn });
    new cdk.CfnOutput(this, 'ProcessorDlqUrl', { value: processorDlq.queueUrl });
    new cdk.CfnOutput(this, 'AlertTopicArn', { value: this.alertTopic.topicArn });
    new cdk.CfnOutput(this, 'DoclingUrlParamName', { value: doclingUrlParam.parameterName });
    new cdk.CfnOutput(this, 'TraceEventBusArn', { value: this.traceEventBus.eventBusArn });
    new cdk.CfnOutput(this, 'WebhookDispatcherArn', { value: webhookDispatcher.functionArn });
  }
}
