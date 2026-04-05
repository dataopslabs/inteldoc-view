import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

interface ApiStackProps extends cdk.StackProps {
  tenantsTable: dynamodb.Table;
  workspacesTable: dynamodb.Table;
  tracesTable: dynamodb.Table;
  sessionsTable: dynamodb.Table;
  hitlReviewsTable: dynamodb.Table;
  userPool: cognito.UserPool;
  documentsBucket: s3.Bucket;
  processorFunctionArn: string;
  doclingServiceUrl?: string;
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
      userPool,
      documentsBucket,
      processorFunctionArn,
      doclingServiceUrl,
    } = props;

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
        USER_POOL_ID: userPool.userPoolId,
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        PROCESSOR_FUNCTION_ARN: processorFunctionArn,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        ...(doclingServiceUrl ? { DOCLING_SERVICE_URL: doclingServiceUrl } : {}),
      },
    });

    // DynamoDB permissions
    for (const table of [tenantsTable, workspacesTable, tracesTable, sessionsTable, hitlReviewsTable]) {
      table.grantReadWriteData(apiFunction);
    }

    // S3 write permission (uploads)
    documentsBucket.grantPut(apiFunction);

    // Lambda invoke permission (async trigger to processor)
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [processorFunctionArn],
      })
    );

    // API Gateway
    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: 'docops-api-gateway',
      description: 'DocOps Agenticore Gateway',
      deployOptions: {
        stageName: 'v1',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-User-Email'],
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

    // Outputs
    new cdk.CfnOutput(this, 'ApiEndpointUrl', { value: api.url });
    new cdk.CfnOutput(this, 'ApiLambdaArn', { value: apiFunction.functionArn });
  }
}
