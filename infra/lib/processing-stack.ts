import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

interface ProcessingStackProps extends cdk.StackProps {
  tracesTable: dynamodb.Table;
  workspacesTable: dynamodb.Table;
  doclingServiceUrl: string;
}

export class ProcessingStack extends cdk.Stack {
  public readonly documentsBucket: s3.Bucket;
  public readonly processorFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, props);

    const { tracesTable, workspacesTable, doclingServiceUrl } = props;

    // S3 bucket for document uploads
    this.documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: `docops-documents-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
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

    // Python workflow Lambda (Phase 3 — replaces Phase 2 processor)
    this.processorFunction = new lambda.Function(this, 'ProcessorFunction', {
      functionName: 'docops-processor',
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'workflow.handler.handler',
      code: lambda.Code.fromAsset('../services', {
        bundling: {
          image: lambda.Runtime.PYTHON_3_11.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r workflow/requirements.txt -t /asset-output && cp -r workflow processor /asset-output',
          ],
        },
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
      },
    });

    // Permissions
    tracesTable.grantReadWriteData(this.processorFunction);
    workspacesTable.grantReadData(this.processorFunction);
    this.documentsBucket.grantReadWrite(this.processorFunction);

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

    // Outputs
    new cdk.CfnOutput(this, 'DocumentsBucketName', { value: this.documentsBucket.bucketName });
    new cdk.CfnOutput(this, 'ProcessorFunctionArn', { value: this.processorFunction.functionArn });
  }
}
