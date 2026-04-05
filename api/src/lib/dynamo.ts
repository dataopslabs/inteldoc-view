import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

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
  keyValue: string
): Promise<T[]> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: '#k = :v',
      ExpressionAttributeNames: { '#k': keyName },
      ExpressionAttributeValues: { ':v': keyValue },
    })
  );
  return (result.Items as T[]) ?? [];
}

export { docClient, UpdateCommand, DeleteCommand };
