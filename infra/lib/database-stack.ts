import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {
  public readonly tenantsTable: dynamodb.Table;
  public readonly workspacesTable: dynamodb.Table;
  public readonly tracesTable: dynamodb.Table;
  public readonly sessionsTable: dynamodb.Table;
  public readonly hitlReviewsTable: dynamodb.Table;
  public readonly usageTable: dynamodb.Table;
  public readonly usageEventsTable: dynamodb.Table;
  // G5-23: Audit log table for compliance (SOC 2, GDPR Article 30)
  public readonly auditLogTable: dynamodb.Table;
  // G5-12: Webhook registrations table
  public readonly webhooksTable: dynamodb.Table;
  // G6-18: Session memory table — one item per message turn
  public readonly sessionMemoryTable: dynamodb.Table;
  // G5-09: Customer-managed KMS key for all DynamoDB tables
  public readonly tableEncryptionKey: kms.Key;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // G5-09: Customer-managed KMS key for DynamoDB encryption.
    // Enables key rotation, CloudTrail audit of all decrypt operations, and
    // compliance with data residency requirements.
    this.tableEncryptionKey = new kms.Key(this, 'DynamoEncryptionKey', {
      alias: 'docops/dynamodb',
      description: 'DocOps — customer-managed key for DynamoDB table encryption',
      enableKeyRotation: true, // Auto-rotate annually per security best practice
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const encryption = dynamodb.TableEncryption.CUSTOMER_MANAGED;
    const encryptionKey = this.tableEncryptionKey;

    // Tenants table
    this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      tableName: 'docops-tenants',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      encryption,
      encryptionKey,
    });
    this.tenantsTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // G6-01: user-id-index for first-login tenant lookup by Cognito sub (userId)
    this.tenantsTable.addGlobalSecondaryIndex({
      indexName: 'user-id-index',
      partitionKey: { name: 'user_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Workspaces table
    this.workspacesTable = new dynamodb.Table(this, 'WorkspacesTable', {
      tableName: 'docops-workspaces',
      partitionKey: { name: 'workspace_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      encryption,
      encryptionKey,
    });
    this.workspacesTable.addGlobalSecondaryIndex({
      indexName: 'tenant-index',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Traces table
    this.tracesTable = new dynamodb.Table(this, 'TracesTable', {
      tableName: 'docops-traces',
      partitionKey: { name: 'trace_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      encryption,
      encryptionKey,
    });
    this.tracesTable.addGlobalSecondaryIndex({
      indexName: 'workspace-index',
      partitionKey: { name: 'workspace_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // G5-19: tenant-index for cross-workspace tenant queries (e.g. GDPR export, tenant dashboards)
    this.tracesTable.addGlobalSecondaryIndex({
      indexName: 'tenant-index',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Sessions table — TTL 30 days; handler sets expires_at = now + 30*24*3600
    this.sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: 'docops-sessions',
      partitionKey: { name: 'session_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expires_at',
      encryption,
      encryptionKey,
    });
    this.sessionsTable.addGlobalSecondaryIndex({
      indexName: 'workspace-index',
      partitionKey: { name: 'workspace_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // HITL Reviews table
    this.hitlReviewsTable = new dynamodb.Table(this, 'HitlReviewsTable', {
      tableName: 'docops-hitl-reviews',
      partitionKey: { name: 'trace_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      encryption,
      encryptionKey,
    });
    this.hitlReviewsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // T4-09 / G5-14: tenant-index GSI — enables listing reviews for a tenant without workspace filter.
    this.hitlReviewsTable.addGlobalSecondaryIndex({
      indexName: 'tenant-index',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.hitlReviewsTable.addGlobalSecondaryIndex({
      indexName: 'workspace-index',
      partitionKey: { name: 'workspace_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Usage tracking table
    this.usageTable = new dynamodb.Table(this, 'UsageTable', {
      tableName: 'docops-usage',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'billing_period', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      encryption,
      encryptionKey,
    });

    // Usage events table — immutable billing log; TTL 1 year for compliance/cost
    this.usageEventsTable = new dynamodb.Table(this, 'UsageEventsTable', {
      tableName: 'docops-usage-events',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'event_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expires_at',
      encryption,
      encryptionKey,
    });
    this.usageEventsTable.addGlobalSecondaryIndex({
      indexName: 'billing-period-index',
      partitionKey: { name: 'billing_period', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // G5-23: Audit log table — immutable compliance log, 7-year TTL.
    // Partition key: tenant_id + sort key: audit_id for efficient tenant-scoped queries.
    // TTL auto-expires entries after 7 years (SOC 2 / GDPR Article 30 requirement).
    this.auditLogTable = new dynamodb.Table(this, 'AuditLogTable', {
      tableName: 'docops-audit-log',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'audit_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expires_at',
      encryption,
      encryptionKey,
    });
    // Index by action for compliance queries: "show all workspace.deleted events"
    this.auditLogTable.addGlobalSecondaryIndex({
      indexName: 'action-index',
      partitionKey: { name: 'action', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // G5-12: Webhook registrations table — stores tenant webhook endpoint URLs + signing secrets.
    // The signing_secret is stored in DynamoDB (encrypted at rest via KMS).
    // In a highest-security deployment, consider migrating signing secrets to AWS Secrets Manager.
    this.webhooksTable = new dynamodb.Table(this, 'WebhooksTable', {
      tableName: 'docops-webhooks',
      partitionKey: { name: 'webhook_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      encryption,
      encryptionKey,
    });
    // tenant-index: list all webhooks for a tenant in O(1)
    this.webhooksTable.addGlobalSecondaryIndex({
      indexName: 'tenant-index',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // G6-18: Session memory table — one item per message turn to avoid 400 KB item limit
    this.sessionMemoryTable = new dynamodb.Table(this, 'SessionMemoryTable', {
      tableName: 'docops-session-memory',
      partitionKey: { name: 'session_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'turn_index', type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
      timeToLiveAttribute: 'expires_at',
      encryption,
      encryptionKey,
    });

    // Outputs
    new cdk.CfnOutput(this, 'TenantsTableName', { value: this.tenantsTable.tableName });
    new cdk.CfnOutput(this, 'WorkspacesTableName', { value: this.workspacesTable.tableName });
    new cdk.CfnOutput(this, 'TracesTableName', { value: this.tracesTable.tableName });
    new cdk.CfnOutput(this, 'SessionsTableName', { value: this.sessionsTable.tableName });
    new cdk.CfnOutput(this, 'HitlReviewsTableName', { value: this.hitlReviewsTable.tableName });
    new cdk.CfnOutput(this, 'UsageTableName', { value: this.usageTable.tableName });
    new cdk.CfnOutput(this, 'UsageEventsTableName', { value: this.usageEventsTable.tableName });
    new cdk.CfnOutput(this, 'AuditLogTableName', { value: this.auditLogTable.tableName });
    new cdk.CfnOutput(this, 'WebhooksTableName', { value: this.webhooksTable.tableName });
    new cdk.CfnOutput(this, 'SessionMemoryTableName', { value: this.sessionMemoryTable.tableName });
    new cdk.CfnOutput(this, 'DynamoEncryptionKeyArn', { value: this.tableEncryptionKey.keyArn });
  }
}
