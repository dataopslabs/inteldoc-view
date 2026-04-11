import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

interface ApiStackProps extends cdk.StackProps {
  tenantsTable: dynamodb.Table;
  workspacesTable: dynamodb.Table;
  tracesTable: dynamodb.Table;
  sessionsTable: dynamodb.Table;
  hitlReviewsTable: dynamodb.Table;
  usageTable: dynamodb.Table;
  usageEventsTable: dynamodb.Table;
  // G5-23: Audit log table
  auditLogTable?: dynamodb.Table;
  // G5-12: Webhooks registrations table
  webhooksTable?: dynamodb.Table;
  // G6-18: Session memory table
  sessionMemoryTable?: dynamodb.Table;
  userPool: cognito.UserPool;
  documentsBucket: s3.Bucket;
  processorFunctionArn: string;
  doclingServiceUrl?: string;
  // T4-05: Shared alert topic from ProcessingStack for all operational alarms
  alertTopic?: sns.Topic;
}

export class ApiStack extends cdk.Stack {
  public readonly apiEndpointUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      tenantsTable,
      workspacesTable,
      tracesTable,
      sessionsTable,
      hitlReviewsTable,
      usageTable,
      usageEventsTable,
      auditLogTable,
      webhooksTable,
      sessionMemoryTable,
      userPool,
      documentsBucket,
      processorFunctionArn,
      doclingServiceUrl,
      alertTopic,
    } = props;

    // G5-11: Store USER_POOL_ID in SSM for auditability
    const userPoolIdParam = new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: '/docops/user-pool-id',
      stringValue: userPool.userPoolId,
      description: 'DocOps — Cognito User Pool ID for JWT validation',
    });

    // Lambda Function
    const apiFunction = new lambda.Function(this, 'ApiFunction', {
      functionName: 'docops-api',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('../api/dist'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        TENANTS_TABLE: tenantsTable.tableName,
        WORKSPACES_TABLE: workspacesTable.tableName,
        TRACES_TABLE: tracesTable.tableName,
        SESSIONS_TABLE: sessionsTable.tableName,
        HITL_REVIEWS_TABLE: hitlReviewsTable.tableName,
        USAGE_TABLE: usageTable.tableName,
        USAGE_EVENTS_TABLE: usageEventsTable.tableName,
        AUDIT_TABLE: auditLogTable?.tableName ?? 'docops-audit-log',
        WEBHOOKS_TABLE: webhooksTable?.tableName ?? 'docops-webhooks',
        SESSION_MEMORY_TABLE: sessionMemoryTable?.tableName ?? 'docops-session-memory',
        USER_POOL_ID: userPool.userPoolId,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        PROCESSOR_FUNCTION_ARN: processorFunctionArn,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
        ...(doclingServiceUrl ? { DOCLING_SERVICE_URL: doclingServiceUrl } : {}),
      },
      // T4-07: Reserved concurrency — 50 concurrent executions for the API Lambda.
      reservedConcurrentExecutions: 50,
      // G5-01: Enable AWS X-Ray active tracing on the API Lambda
      tracing: lambda.Tracing.ACTIVE,
    });

    // DynamoDB permissions
    const tables = [tenantsTable, workspacesTable, tracesTable, sessionsTable, hitlReviewsTable, usageTable, usageEventsTable];
    if (auditLogTable) tables.push(auditLogTable);
    if (webhooksTable) tables.push(webhooksTable);
    if (sessionMemoryTable) tables.push(sessionMemoryTable);
    for (const table of tables) {
      table.grantReadWriteData(apiFunction);
    }

    // S3 permissions (uploads + deep health check)
    documentsBucket.grantPut(apiFunction);
    documentsBucket.grantRead(apiFunction);

    // Lambda invoke permission (async trigger to processor)
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [processorFunctionArn],
      })
    );

    // Bedrock invoke permission (chat + deep health check)
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
        ],
      })
    );

    // G5-11: Grant SSM read permission for config parameters
    userPoolIdParam.grantRead(apiFunction);

    // G5-29: CloudWatch log group for API Gateway access logs (3-month retention)
    const accessLogGroup = new logs.LogGroup(this, 'ApiAccessLogs', {
      logGroupName: '/docops/api-gateway/access-logs',
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // API Gateway — G5-29 access logging + G5-01 X-Ray tracing enabled
    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: 'docops-api-gateway',
      description: 'DocOps Agenticore Gateway',
      deployOptions: {
        stageName: 'v1',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false, // Disabled in production — request bodies contain PII
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        // G5-29: Structured JSON access log with all critical fields for security + debugging
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogGroup),
        accessLogFormat: apigateway.AccessLogFormat.custom(JSON.stringify({
          requestId: '$context.requestId',
          requestTime: '$context.requestTime',
          httpMethod: '$context.httpMethod',
          resourcePath: '$context.resourcePath',
          status: '$context.status',
          protocol: '$context.protocol',
          responseLength: '$context.responseLength',
          latencyMs: '$context.responseLatency',
          integrationLatencyMs: '$context.integrationLatency',
          ip: '$context.identity.sourceIp',
          userAgent: '$context.identity.userAgent',
          errorMessage: '$context.error.message',
          xrayTraceId: '$context.xrayTraceId',
        })),
        // G5-01: Enable X-Ray tracing at the API Gateway stage level
        tracingEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [
          'http://localhost:3000',
          'https://docops.dataopslabs.com',
        ],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization', 'X-User-Email'],
        allowCredentials: true,
      },
    });

    // Proxy all routes to Lambda
    const proxy = api.root.addResource('{proxy+}');
    const lambdaIntegration = new apigateway.LambdaIntegration(apiFunction, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });
    proxy.addMethod('ANY', lambdaIntegration);
    api.root.addMethod('ANY', lambdaIntegration);

    this.apiEndpointUrl = api.url;

    // ── T4-15: WAF v2 WebACL ──────────────────────────────────────────────────
    const webAcl = new wafv2.CfnWebACL(this, 'ApiWebAcl', {
      name: 'docops-api-waf',
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'docops-api-waf',
      },
      rules: [
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSet',
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
        },
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesKnownBadInputsRuleSet',
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
        },
        {
          name: 'RateLimitPerIP',
          priority: 3,
          action: { block: {} },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitPerIP',
          },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
        },
      ],
    });

    new wafv2.CfnWebACLAssociation(this, 'ApiWebAclAssociation', {
      resourceArn: `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/stages/${api.deploymentStage.stageName}`,
      webAclArn: webAcl.attrArn,
    });

    // ── T4-05: CloudWatch Alarms ──────────────────────────────────────────────
    const notifyTopic = alertTopic ?? new sns.Topic(this, 'DocOpsAlertTopicFallback', {
      topicName: 'docops-ops-alerts-api',
    });

    const apiErrorAlarm = new cloudwatch.Alarm(this, 'ApiErrorAlarm', {
      alarmName: 'docops-api-errors',
      alarmDescription: 'API Lambda error rate is elevated — check CloudWatch logs',
      metric: apiFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(notifyTopic));
    apiErrorAlarm.addOkAction(new cloudwatchActions.SnsAction(notifyTopic));

    const apiThrottleAlarm = new cloudwatch.Alarm(this, 'ApiThrottleAlarm', {
      alarmName: 'docops-api-throttles',
      alarmDescription: 'API Lambda throttles elevated — consider raising reserved concurrency',
      metric: apiFunction.metricThrottles({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 20,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiThrottleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(notifyTopic));

    const apiGateway5xxAlarm = new cloudwatch.Alarm(this, 'ApiGateway5xxAlarm', {
      alarmName: 'docops-apigw-5xx',
      alarmDescription: 'API Gateway 5xx error rate exceeded 5% — investigate Lambda errors',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5XXError',
        dimensionsMap: {
          ApiName: 'docops-api-gateway',
          Stage: 'v1',
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 0.05,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiGateway5xxAlarm.addAlarmAction(new cloudwatchActions.SnsAction(notifyTopic));

    const apiLatencyAlarm = new cloudwatch.Alarm(this, 'ApiLatencyAlarm', {
      alarmName: 'docops-api-latency-p99',
      alarmDescription: 'API Lambda p99 latency > 10s — investigate slow operations',
      metric: apiFunction.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: 'p99',
      }),
      threshold: 10_000,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiLatencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(notifyTopic));

    // ── G5-16: CloudWatch Operational Dashboard ───────────────────────────────
    // Comprehensive view of API health, latency, error rates, and alarm status.
    const dashboard = new cloudwatch.Dashboard(this, 'OperationalDashboard', {
      dashboardName: 'DocOps-Operations',
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Lambda — Invocations / Errors / Throttles',
        left: [
          apiFunction.metricInvocations({ period: cdk.Duration.minutes(5), statistic: 'Sum', label: 'Invocations' }),
          apiFunction.metricErrors({ period: cdk.Duration.minutes(5), statistic: 'Sum', label: 'Errors' }),
          apiFunction.metricThrottles({ period: cdk.Duration.minutes(5), statistic: 'Sum', label: 'Throttles' }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Lambda — Duration p50 / p99',
        left: [
          apiFunction.metricDuration({ period: cdk.Duration.minutes(5), statistic: 'p50', label: 'p50 ms' }),
          apiFunction.metricDuration({ period: cdk.Duration.minutes(5), statistic: 'p99', label: 'p99 ms' }),
        ],
        width: 12,
        height: 6,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway — 4xx / 5xx Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '4XXError',
            dimensionsMap: { ApiName: 'docops-api-gateway', Stage: 'v1' },
            period: cdk.Duration.minutes(5),
            statistic: 'Sum',
            label: '4xx',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '5XXError',
            dimensionsMap: { ApiName: 'docops-api-gateway', Stage: 'v1' },
            period: cdk.Duration.minutes(5),
            statistic: 'Sum',
            label: '5xx',
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway — Latency p50 / p99',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: { ApiName: 'docops-api-gateway', Stage: 'v1' },
            period: cdk.Duration.minutes(5),
            statistic: 'p50',
            label: 'p50 ms',
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Latency',
            dimensionsMap: { ApiName: 'docops-api-gateway', Stage: 'v1' },
            period: cdk.Duration.minutes(5),
            statistic: 'p99',
            label: 'p99 ms',
          }),
        ],
        width: 12,
        height: 6,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: 'Operational Alarm Status',
        alarms: [apiErrorAlarm, apiThrottleAlarm, apiGateway5xxAlarm, apiLatencyAlarm],
        width: 24,
        height: 4,
      }),
    );

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpointUrl', { value: api.url });
    new cdk.CfnOutput(this, 'ApiLambdaArn', { value: apiFunction.functionArn });
    new cdk.CfnOutput(this, 'WebAclArn', { value: webAcl.attrArn });
    new cdk.CfnOutput(this, 'AccessLogGroupName', { value: accessLogGroup.logGroupName });
    new cdk.CfnOutput(this, 'DashboardName', { value: dashboard.dashboardName });
  }
}
