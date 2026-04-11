/**
 * G5-14: Auth middleware — JWT validation + RBAC role extraction.
 *
 * Extracts tenant_id, user_id, and role from the Cognito JWT.
 * Role is derived from `cognito:groups` claim — the first matching group wins.
 * Groups in Cognito: docops-admin, docops-editor, docops-reviewer, docops-viewer.
 */
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { ApiRequest, RequestContext, UserRole } from '../models/types';

const PUBLIC_PATHS = ['/v1/health', '/v1/health/ready', '/v1/auth/google'];

const jwks = jwksClient({
  jwksUri: `https://cognito-idp.${process.env.AWS_REGION ?? 'us-east-1'}.amazonaws.com/${process.env.USER_POOL_ID}/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 600000,
});

function getSigningKey(kid: string): Promise<string> {
  return new Promise((resolve, reject) => {
    jwks.getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      resolve(key!.getPublicKey());
    });
  });
}

/** Map Cognito group names to internal roles. */
const GROUP_ROLE_MAP: Record<string, UserRole> = {
  'docops-admin': 'admin',
  'docops-editor': 'editor',
  'docops-reviewer': 'reviewer',
  'docops-viewer': 'viewer',
};

function extractRole(groups: string[] | undefined): UserRole {
  if (!groups || groups.length === 0) return 'viewer';
  // Priority: admin > editor > reviewer > viewer
  const priority: UserRole[] = ['admin', 'editor', 'reviewer', 'viewer'];
  for (const role of priority) {
    const group = `docops-${role}`;
    if (groups.includes(group)) return role;
  }
  return 'viewer';
}

export async function authMiddleware(
  method: string,
  path: string,
  headers: Record<string, string>
): Promise<RequestContext | null> {
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith('/v1/auth/'));
  if (isPublic) {
    return { tenantId: '', userId: '', role: 'viewer' };
  }

  const authHeader = headers['authorization'] ?? headers['Authorization'] ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') return null;

    const kid = decoded.header.kid;
    const signingKey = await getSigningKey(kid);

    const payload = jwt.verify(token, signingKey, {
      algorithms: ['RS256'],
    }) as jwt.JwtPayload;

    // G5-14: Extract Cognito groups and map to role
    const groups = payload['cognito:groups'] as string[] | undefined;
    const role = extractRole(groups);

    return {
      tenantId: (payload['custom:tenant_id'] as string) ?? payload.sub ?? '',
      userId: payload.sub ?? '',
      role,
    };
  } catch {
    return null;
  }
}

/** G5-14: Role-based access check helper. */
export function requireRole(context: RequestContext, minimumRole: UserRole): boolean {
  const hierarchy: UserRole[] = ['viewer', 'reviewer', 'editor', 'admin'];
  const userLevel = hierarchy.indexOf(context.role ?? 'viewer');
  const requiredLevel = hierarchy.indexOf(minimumRole);
  return userLevel >= requiredLevel;
}
