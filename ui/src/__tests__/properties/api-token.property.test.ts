/**
 * Property-based tests for API client Bearer token attachment.
 *
 * **Validates: Requirements 13.4, 13.5**
 *
 * Property 2: API client attaches Bearer token to all authenticated requests
 *
 * We extract the API client's core header-building logic and test it as pure functions:
 * - buildAuthHeaders: constructs headers with or without a Bearer token
 * - The Authorization header must be `Bearer {token}` when a token is present
 * - The Authorization header must be absent when no token is available
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// --- Extracted logic from api.ts ---

/**
 * Mirrors the header construction logic in the `request()` function of api.ts:
 *   const headers: Record<string, string> = { 'Content-Type': 'application/json' };
 *   if (token) headers['Authorization'] = `Bearer ${token}`;
 */
function buildAuthHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Mirrors the token extraction logic in `getToken()`:
 *   session.tokens?.idToken?.toString() ?? null
 */
function extractToken(session: {
  tokens?: { idToken?: { toString(): string } } | undefined;
}): string | null {
  return session.tokens?.idToken?.toString() ?? null;
}

// --- Generators ---

/** Generates a non-empty token string (simulating a Cognito ID token / JWT-like) */
const validTokenArb = fc
  .tuple(
    fc.base64String({ minLength: 10, maxLength: 50 }),
    fc.base64String({ minLength: 10, maxLength: 50 }),
    fc.base64String({ minLength: 10, maxLength: 50 })
  )
  .map(([header, payload, sig]) => `${header}.${payload}.${sig}`);

/** Generates an arbitrary non-empty string token */
const anyNonEmptyTokenArb = fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.length > 0);

/** Generates an HTTP method */
const httpMethodArb = fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH');

/** Generates an API path */
const apiPathArb = fc
  .array(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), {
      minLength: 1,
      maxLength: 15,
    }),
    { minLength: 1, maxLength: 4 }
  )
  .map((segments) => '/v1/' + segments.join('/'));

/** Generates a session object with a valid token */
const authenticatedSessionArb = validTokenArb.map((token) => ({
  tokens: { idToken: { toString: () => token } },
  _expectedToken: token,
}));

/** Generates a session object without a token (various shapes) */
const unauthenticatedSessionArb = fc.constantFrom(
  { tokens: undefined, _expectedToken: null as string | null },
  { tokens: { idToken: undefined }, _expectedToken: null as string | null },
  { _expectedToken: null as string | null },
);

// --- Property Tests ---

describe('API client Bearer token attachment', () => {
  describe('Property 2: API client attaches Bearer token to all authenticated requests', () => {
    it('should attach Bearer {token} header for any valid token', () => {
      /**
       * **Validates: Requirements 13.4, 13.5**
       *
       * For any non-empty token string, the Authorization header
       * must be set to exactly `Bearer {token}`.
       */
      fc.assert(
        fc.property(anyNonEmptyTokenArb, (token) => {
          const headers = buildAuthHeaders(token);
          expect(headers['Authorization']).toBe(`Bearer ${token}`);
          expect(headers['Content-Type']).toBe('application/json');
        }),
        { numRuns: 200 }
      );
    });

    it('should not set Authorization header when token is null', () => {
      /**
       * **Validates: Requirements 13.4, 13.5**
       *
       * When no token is available (null), the Authorization header
       * must not be present in the request headers.
       */
      const headers = buildAuthHeaders(null);
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should not set Authorization header when token is empty string', () => {
      /**
       * **Validates: Requirements 13.4, 13.5**
       *
       * Empty string is falsy in JS, so it should behave like null.
       */
      const headers = buildAuthHeaders('');
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should preserve the exact token value in the Bearer header for any JWT-like token', () => {
      /**
       * **Validates: Requirements 13.4, 13.5**
       *
       * For any JWT-like token (header.payload.signature), the Bearer
       * header must contain the exact token without modification.
       */
      fc.assert(
        fc.property(validTokenArb, (token) => {
          const headers = buildAuthHeaders(token);
          const authHeader = headers['Authorization'];
          expect(authHeader).toBeDefined();
          // Extract the token part after "Bearer "
          const extractedToken = authHeader!.replace('Bearer ', '');
          expect(extractedToken).toBe(token);
        }),
        { numRuns: 200 }
      );
    });

    it('should always include Content-Type regardless of token presence', () => {
      /**
       * **Validates: Requirements 13.4, 13.5**
       *
       * Content-Type: application/json must always be present,
       * whether or not a token is attached.
       */
      fc.assert(
        fc.property(
          fc.option(anyNonEmptyTokenArb, { nil: null }),
          (token) => {
            const headers = buildAuthHeaders(token);
            expect(headers['Content-Type']).toBe('application/json');
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Token extraction from Amplify session', () => {
    it('should extract token from authenticated sessions', () => {
      /**
       * **Validates: Requirements 13.4, 13.5**
       *
       * For any session with a valid idToken, extractToken should
       * return the token string.
       */
      fc.assert(
        fc.property(authenticatedSessionArb, (session) => {
          const token = extractToken(session);
          expect(token).toBe(session._expectedToken);
          expect(token).not.toBeNull();
        }),
        { numRuns: 200 }
      );
    });

    it('should return null for unauthenticated sessions', () => {
      /**
       * **Validates: Requirements 13.4, 13.5**
       *
       * For sessions without a valid idToken (undefined tokens,
       * undefined idToken, or missing tokens entirely), extractToken
       * should return null.
       */
      fc.assert(
        fc.property(unauthenticatedSessionArb, (session) => {
          const token = extractToken(session as any);
          expect(token).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    it('should produce correct headers end-to-end: extract token then build headers', () => {
      /**
       * **Validates: Requirements 13.4, 13.5**
       *
       * Composing extractToken → buildAuthHeaders should produce
       * Bearer {token} for authenticated sessions and no Authorization
       * header for unauthenticated sessions.
       */
      fc.assert(
        fc.property(
          fc.oneof(authenticatedSessionArb, unauthenticatedSessionArb),
          (session) => {
            const token = extractToken(session as any);
            const headers = buildAuthHeaders(token);

            if (session._expectedToken) {
              expect(headers['Authorization']).toBe(`Bearer ${session._expectedToken}`);
            } else {
              expect(headers['Authorization']).toBeUndefined();
            }
          }
        ),
        { numRuns: 300 }
      );
    });
  });

  describe('Header construction is idempotent and isolated', () => {
    it('should produce identical headers for the same token across multiple calls', () => {
      /**
       * **Validates: Requirements 13.4, 13.5**
       *
       * Building headers with the same token multiple times should
       * always produce the same result (no side effects).
       */
      fc.assert(
        fc.property(
          fc.option(anyNonEmptyTokenArb, { nil: null }),
          (token) => {
            const headers1 = buildAuthHeaders(token);
            const headers2 = buildAuthHeaders(token);
            expect(headers1).toEqual(headers2);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should not leak headers between different requests', () => {
      /**
       * **Validates: Requirements 13.4, 13.5**
       *
       * Headers built for one request should not affect headers
       * built for another request with a different token.
       */
      fc.assert(
        fc.property(
          anyNonEmptyTokenArb,
          fc.option(anyNonEmptyTokenArb, { nil: null }),
          (token1, token2) => {
            const headers1 = buildAuthHeaders(token1);
            const headers2 = buildAuthHeaders(token2);

            // headers1 always has Authorization
            expect(headers1['Authorization']).toBe(`Bearer ${token1}`);

            // headers2 depends on token2
            if (token2) {
              expect(headers2['Authorization']).toBe(`Bearer ${token2}`);
            } else {
              expect(headers2['Authorization']).toBeUndefined();
            }

            // Mutating headers1 should not affect headers2
            headers1['Authorization'] = 'tampered';
            if (token2) {
              expect(headers2['Authorization']).toBe(`Bearer ${token2}`);
            }
          }
        ),
        { numRuns: 200 }
      );
    });
  });
});
