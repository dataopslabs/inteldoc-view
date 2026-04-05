import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class DatabaseStack extends cdk.Stack {
  public readonly tenantsTable: dynamodb.Table;
  public readonly workspacesTable: dynamodb.Table;
  public readonly tracesTable: dynamodb.Table;
  public readonly sessionsTable: dynamodb.Table;
  public readonly hitlReviewsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Tenants table
    this.tenantsTable = new dynamodb.Table(this, 'TenantsTable', {
      tableName: 'docops-tenants',
      partitionKey: { name: 'tenant_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    this.tenantsTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Workspaces table
    this.workspacesTable = new dynamodb.Table(this, 'WorkspacesTable', {
      tableName: 'docops-workspaces',
      partitionKey: { name: 'workspace_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
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
    });
    this.tracesTable.addGlobalSecondaryIndex({
      indexName: 'workspace-index',
      partitionKey: { name: 'workspace_id', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Sessions table
    this.sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: 'docops-sessions',
      partitionKey: { name: 'session_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
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
    });
    this.hitlReviewsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Outputs
    new cdk.CfnOutput(this, 'TenantsTableName', { value: this.tenantsTable.tableName });
    new cdk.CfnOutput(this, 'WorkspacesTableName', { value: this.workspacesTable.tableName });
    new cdk.CfnOutput(this, 'TracesTableName', { value: this.tracesTable.tableName });
    new cdk.CfnOutput(this, 'SessionsTableName', { value: this.sessionsTable.tableName });
    new cdk.CfnOutput(this, 'HitlReviewsTableName', { value: this.hitlReviewsTable.tableName });
  }
}
