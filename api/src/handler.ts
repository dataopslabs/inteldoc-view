import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from './middleware/auth';
import { resolveTenant } from './middleware/tenant';
import { routeEnforcement, buildWarningHeaders } from './middleware/plan-enforcer';
import { route } from './router';
import { ApiRequest } from './models/types';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'https://docops.dataopslabs.com',
]);

// 10 MB raw body limit — guards against oversized base64 payloads crashing Lambda
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  // T4-04: 1-year HSTS — signals to browsers to enforce HTTPS exclusively for 12 months.
  // includeSubDomains protects all sub-domains. Only enable once all sub-domains support HTTPS.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // CSP: restrict to same-origin; tighten inline-styles once UI is updated
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; frame-ancestors 'none'",
};

function getCorsHeaders(origin: string): Record<string, string> {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : 'https://docops.dataopslabs.com';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-User-Email',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  };
}

function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, ctx: Record<string, unknown> = {}): void {
  console[level === 'INFO' ? 'log' : level === 'WARN' ? 'warn' : 'error'](
    JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...ctx })
  );
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const origin = event.headers?.['origin'] ?? event.headers?.['Origin'] ?? '';
  const CORS_HEADERS = getCorsHeaders(origin);
  const ALL_HEADERS = { ...CORS_HEADERS, ...SECURITY_HEADERS };

  // Attach a correlation ID to every response for distributed tracing
  const correlationId = (event.headers?.['x-correlation-id'] ?? uuidv4()) as string;
  const RESPONSE_HEADERS = { ...ALL_HEADERS, 'X-Correlation-ID': correlationId };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: RESPONSE_HEADERS, body: '' };
  }

  // API Gateway strips the stage prefix before invoking Lambda.
  // Normalize so internal routing always sees /v1/* paths.
  const rawPath = event.path ?? '/';
  const path = rawPath.startsWith('/v1') ? rawPath : `/v1${rawPath}`;
  const method = event.httpMethod ?? 'GET';
  const headers = Object.fromEntries(
    Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v ?? ''])
  );

  // Body size gate — reject before JSON.parse to protect Lambda memory
  if (event.body && Buffer.byteLength(event.body, 'utf8') > MAX_BODY_BYTES) {
    return {
      statusCode: 413,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: 'Request body exceeds maximum allowed size of 10MB' }),
    };
  }

  let body: unknown = null;
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch {
      return {
        statusCode: 400,
        headers: RESPONSE_HEADERS,
        body: JSON.stringify({ error: 'Invalid JSON body' }),
      };
    }
  }

  // Auth middleware
  const context = await authMiddleware(method, path, headers);
  if (context === null) {
    log('WARN', 'Unauthorized request', { path, method, correlation_id: correlationId });
    return {
      statusCode: 401,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }

  // Tenant resolution (skip for public routes)
  // G6-01: isPublic now includes /v1/health/ready so tenant resolution is never
  //        attempted on health-check paths (prevents spurious DynamoDB calls + log noise).
  // G6-04: tenant_id is resolved from the JWT custom:tenant_id claim inside resolveTenant;
  //        the X-User-Email header is only used as a fallback for first-login auto-provisioning
  //        and is NEVER the primary source of trust for tenant identity.
  const isPublic = path === '/v1/health' || path === '/v1/health/ready' || path.startsWith('/v1/auth/');
  if (!isPublic && context.userId) {
    try {
      // G6-01: Pass email header only as a provisioning hint; resolveTenant prefers
      // context.tenantId (from JWT) over the header value for all existing tenants.
      const email = headers['x-user-email'] ?? '';
      await resolveTenant(context, email);
    } catch (err) {
      log('ERROR', 'Tenant resolution failed', {
        path,
        error: String(err),
        correlation_id: correlationId,
      });
      return {
        statusCode: 400,
        headers: RESPONSE_HEADERS,
        body: JSON.stringify({ error: 'Tenant resolution failed — ensure your JWT token is valid' }),
      };
    }
  }

  const req: ApiRequest = {
    method,
    path,
    pathParams: (event.pathParameters as Record<string, string>) ?? {},
    queryParams: (event.queryStringParameters as Record<string, string>) ?? {},
    body,
    context,
    headers,
  };

  try {
    // Plan enforcement (after tenant resolution, before routing)
    if (!isPublic && context.tenant) {
      const enforcement = await routeEnforcement(method, path, context.tenant);
      if (!enforcement.allowed) {
        return {
          statusCode: 429,
          headers: RESPONSE_HEADERS,
          body: JSON.stringify(enforcement.rejection),
        };
      }

      const response = await route(req);
      const warningHeaders = buildWarningHeaders(enforcement);
      return {
        statusCode: response.statusCode,
        headers: { ...RESPONSE_HEADERS, ...warningHeaders, ...(response.headers ?? {}) },
        body: JSON.stringify(response.body),
      };
    }

    const response = await route(req);
    return {
      statusCode: response.statusCode,
      headers: { ...RESPONSE_HEADERS, ...(response.headers ?? {}) },
      body: JSON.stringify(response.body),
    };
  } catch (err) {
    log('ERROR', 'Unhandled error', {
      path,
      method,
      error: String(err),
      correlation_id: correlationId,
      tenant_id: context.tenantId,
    });
    return {
      statusCode: 500,
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}
