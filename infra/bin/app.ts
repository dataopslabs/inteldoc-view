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
  description: 'DocOps — DynamoDB tables',
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
});

new ApiStack(app, 'DocOpsApi', {
  env,
  description: 'DocOps — API Gateway and Lambda',
  tenantsTable: dbStack.tenantsTable,
  workspacesTable: dbStack.workspacesTable,
  tracesTable: dbStack.tracesTable,
  sessionsTable: dbStack.sessionsTable,
  hitlReviewsTable: dbStack.hitlReviewsTable,
  userPool: authStack.userPool,
  documentsBucket: processingStack.documentsBucket,
  processorFunctionArn: processingStack.processorFunction.functionArn,
  doclingServiceUrl,
});

app.synth();
