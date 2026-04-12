import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const TABLE_NAMES = {
  tenants: process.env.TENANTS_TABLE ?? 'docops-tenants',
  workspaces: process.env.WORKSPACES_TABLE ?? 'docops-workspaces',
  traces: process.env.TRACES_TABLE ?? 'docops-traces',
  sessions: process.env.SESSIONS_TABLE ?? 'docops-sessions',
  hitlReviews: process.env.HITL_REVIEWS_TABLE ?? 'docops-hitl-reviews',
  usage: process.env.USAGE_TABLE ?? 'docops-usage',
  usageEvents: process.env.USAGE_EVENTS_TABLE ?? 'docops-usage-events',
};

export async function getItem<T>(tableName: string, key: Record<string, unknown>): Promise<T | null> {
  const result = await docClient.send(new GetCommand({ TableName: tableName, Key: key }));
  return (result.Item as T) ?? null;
}

export async function putItem(tableName: string, item: Record<string, unknown>): Promise<void> {
  await docClient.send(new PutCommand({ TableName: tableName, Item: item }));
}

export async function queryIndex<T>(
  tableName: string,
  indexName: string,
  keyName: string,
  keyValue: string,
  limit?: number
): Promise<T[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: '#k = :v',
      ExpressionAttributeNames: { '#k': keyName },
      ExpressionAttributeValues: { ':v': keyValue },
      ...(limit ? { Limit: limit } : {}),
    })
  );
  return (result.Items as T[]) ?? [];
}

export interface PageResult<T> {
  items: T[];
  nextToken?: string; // base64-encoded LastEvaluatedKey
}

export async function queryIndexPaginated<T>(
  tableName: string,
  indexName: string,
  keyName: string,
  keyValue: string,
  limit = 50,
  nextToken?: string
): Promise<PageResult<T>> {
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (nextToken) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf8'));
    } catch {
      // ignore malformed token — start from the beginning
    }
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: '#k = :v',
      ExpressionAttributeNames: { '#k': keyName },
      ExpressionAttributeValues: { ':v': keyValue },
      Limit: Math.min(limit, 100), // hard cap at 100
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    })
  );

  const newNextToken = result.LastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
    : undefined;

  return {
    items: (result.Items as T[]) ?? [],
    nextToken: newNextToken,
  };
}

export async function updateItem(
  tableName: string,
  key: Record<string, unknown>,
  updateExpression: string,
  expressionAttributeNames: Record<string, string>,
  expressionAttributeValues: Record<string, unknown>,
  conditionExpression?: string
): Promise<Record<string, unknown>> {
  const result = await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ConditionExpression: conditionExpression,
    ReturnValues: 'ALL_NEW',
  }));
  return result.Attributes as Record<string, unknown>;
}

export async function deleteItem(tableName: string, key: Record<string, unknown>): Promise<void> {
  await docClient.send(new DeleteCommand({ TableName: tableName, Key: key }));
}

export { docClient, UpdateCommand, DeleteCommand, TransactWriteCommand };

export async function queryAllForWorkspaces<T>(
  tableName: string,
  indexName: string,
  workspaceIds: string[]
): Promise<T[]> {
  const results = await Promise.all(
    workspaceIds.map(wsId => queryIndex<T>(tableName, indexName, 'workspace_id', wsId))
  );
  return results.flat();
}

export async function atomicIncrement(
  tableName: string,
  key: Record<string, unknown>,
  field: string,
  amount: number
): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: 'ADD #field :amount SET #updated = :now',
    ExpressionAttributeNames: { '#field': field, '#updated': 'updated_at' },
    ExpressionAttributeValues: { ':amount': amount, ':now': new Date().toISOString() },
  }));
}
