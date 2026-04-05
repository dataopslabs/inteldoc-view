import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { authMiddleware } from './middleware/auth';
import { resolveTenant } from './middleware/tenant';
import { route } from './router';
import { ApiRequest } from './models/types';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  const path = event.path ?? '/';
  const method = event.httpMethod ?? 'GET';
  const headers = Object.fromEntries(
    Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v ?? ''])
  );

  let body: unknown = null;
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Invalid JSON body' }),
      };
    }
  }

  // Auth middleware
  const context = await authMiddleware(method, path, headers);
  if (context === null) {
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  // Tenant resolution (skip for public routes)
  const isPublic = path === '/v1/health' || path.startsWith('/v1/auth/');
  if (!isPublic && context.userId) {
    try {
      const email = headers['x-user-email'] ?? '';
      await resolveTenant(context, email);
    } catch (err) {
      console.error('Tenant resolution failed', err);
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Internal server error' }),
      };
    }
  }

  const req: ApiRequest = {
    method,
    path,
    pathParams: event.pathParameters ?? {},
    queryParams: (event.queryStringParameters as Record<string, string>) ?? {},
    body,
    context,
    headers,
  };

  try {
    const response = await route(req);
    return {
      statusCode: response.statusCode,
      headers: { ...CORS_HEADERS, ...(response.headers ?? {}) },
      body: JSON.stringify(response.body),
    };
  } catch (err) {
    console.error('Unhandled error', err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}
