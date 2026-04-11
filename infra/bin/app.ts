#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DatabaseStack } from '../lib/database-stack';
import { AuthStack } from '../lib/auth-stack';
import { ProcessingStack } from '../lib/processing-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? '098493093308',
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const doclingServiceUrl =
  (app.node.tryGetContext('doclingServiceUrl') as string | undefined) ??
  process.env.DOCLING_SERVICE_URL ??
  '';

const dbStack = new DatabaseStack(app, 'DocOpsDatabase', {
  env,
  description: 'DocOps — DynamoDB tables + KMS encryption',
});

const authStack = new AuthStack(app, 'DocOpsAuth', {
  env,
  description: 'DocOps — Cognito User Pool and Identity Pool',
});

const processingStack = new ProcessingStack(app, 'DocOpsProcessing', {
  env,
  description: 'DocOps — S3 document store and processing Lambda',
  tracesTable: dbStack.tracesTable,
  workspacesTable: dbStack.workspacesTable,
  doclingServiceUrl,
  // G5-09: Share KMS key from DatabaseStack for S3 encryption (unified key management)
  tableEncryptionKey: dbStack.tableEncryptionKey,
  // G5-12: Pass webhooks table so dispatcher Lambda can query registrations
  webhooksTable: dbStack.webhooksTable,
});

new ApiStack(app, 'DocOpsApi', {
  env,
  description: 'DocOps — API Gateway and Lambda',
  tenantsTable: dbStack.tenantsTable,
  workspacesTable: dbStack.workspacesTable,
  tracesTable: dbStack.tracesTable,
  sessionsTable: dbStack.sessionsTable,
  hitlReviewsTable: dbStack.hitlReviewsTable,
  usageTable: dbStack.usageTable,
  usageEventsTable: dbStack.usageEventsTable,
  // G5-23: Pass audit log table so API Lambda can write compliance events
  auditLogTable: dbStack.auditLogTable,
  // G5-12: Pass webhooks table so API Lambda can manage registrations
  webhooksTable: dbStack.webhooksTable,
  // G6-18: Pass session memory table for per-turn message storage
  sessionMemoryTable: dbStack.sessionMemoryTable,
  userPool: authStack.userPool,
  documentsBucket: processingStack.documentsBucket,
  processorFunctionArn: processingStack.processorFunction.functionArn,
  doclingServiceUrl,
  // T4-05: Share SNS alert topic from ProcessingStack so all alarms route to one topic
  alertTopic: processingStack.alertTopic,
});

app.synth();
