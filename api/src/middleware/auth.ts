import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { ApiRequest, RequestContext } from '../models/types';

const PUBLIC_PATHS = ['/v1/health', '/v1/auth/google'];

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

export async function authMiddleware(
  method: string,
  path: string,
  headers: Record<string, string>
): Promise<RequestContext | null> {
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith('/v1/auth/'));
  if (isPublic) {
    return { tenantId: '', userId: '' };
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

    return {
      tenantId: (payload['custom:tenant_id'] as string) ?? payload.sub ?? '',
      userId: payload.sub ?? '',
    };
  } catch {
    return null;
  }
}
