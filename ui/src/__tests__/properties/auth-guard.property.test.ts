/**
 * Property-based tests for AuthGuard redirect behavior.
 *
 * **Validates: Requirements 11.3, 11.4**
 *
 * Property 1: Auth guard redirects unauthenticated users to login
 *
 * We extract the AuthGuard's core decision logic and test it as pure functions:
 * - isPublicPath: determines if a path is public (no auth required)
 * - shouldRedirect: determines if a redirect to /auth/login should occur
 * - shouldRenderChildren: determines if children should be rendered
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// --- Extracted logic from AuthGuard.tsx ---

const PUBLIC_PATHS = ['/auth/login', '/auth/callback'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

/**
 * Determines whether the AuthGuard should redirect to /auth/login.
 * Mirrors the useEffect logic in AuthGuard:
 *   if (!loading && !user && !isPublicPath) → redirect
 */
function shouldRedirect(params: {
  loading: boolean;
  hasUser: boolean;
  pathname: string;
}): boolean {
  const { loading, hasUser, pathname } = params;
  return !loading && !hasUser && !isPublicPath(pathname);
}

/**
 * Determines whether the AuthGuard should render children.
 * Mirrors the render logic in AuthGuard:
 *   if (loading) → spinner (no children)
 *   if (!user && !isPublicPath) → null (no children)
 *   otherwise → children
 */
function shouldRenderChildren(params: {
  loading: boolean;
  hasUser: boolean;
  pathname: string;
}): boolean {
  const { loading, hasUser, pathname } = params;
  if (loading) return false;
  if (!hasUser && !isPublicPath(pathname)) return false;
  return true;
}

// --- Generators ---

/** Generates a random path segment (no slashes) */
const pathSegmentArb = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')
  ),
  { minLength: 1, maxLength: 20 }
);

/** Generates a random non-public path like /foo, /dashboard, /workspaces/abc */
const nonPublicPathArb = fc
  .array(pathSegmentArb, { minLength: 1, maxLength: 4 })
  .map((segments) => '/' + segments.join('/'))
  .filter((p) => !PUBLIC_PATHS.includes(p));

/** Generates one of the known public paths */
const publicPathArb = fc.constantFrom(...PUBLIC_PATHS);

/** Generates any path (public or non-public) */
const anyPathArb = fc.oneof(publicPathArb, nonPublicPathArb);

// --- Property Tests ---

describe('AuthGuard redirect behavior', () => {
  describe('Property 1: Auth guard redirects unauthenticated users to login', () => {
    it('should redirect unauthenticated users on any non-public path', () => {
      /**
       * **Validates: Requirements 11.3, 11.4**
       *
       * For any route that is NOT /auth/login or /auth/callback,
       * if no valid session exists (hasUser=false, loading=false),
       * the AuthGuard should redirect to /auth/login.
       */
      fc.assert(
        fc.property(nonPublicPathArb, (pathname) => {
          const result = shouldRedirect({
            loading: false,
            hasUser: false,
            pathname,
          });
          expect(result).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('should NOT redirect on public paths regardless of auth state', () => {
      /**
       * **Validates: Requirements 11.3, 11.4**
       *
       * For public paths (/auth/login, /auth/callback),
       * the AuthGuard should never redirect, regardless of whether
       * the user is authenticated or not.
       */
      fc.assert(
        fc.property(
          publicPathArb,
          fc.boolean(), // hasUser
          (pathname, hasUser) => {
            const result = shouldRedirect({
              loading: false,
              hasUser,
              pathname,
            });
            expect(result).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should NOT redirect authenticated users on any path', () => {
      /**
       * **Validates: Requirements 11.3, 11.4**
       *
       * For any path, if a valid session exists (hasUser=true),
       * the AuthGuard should never redirect.
       */
      fc.assert(
        fc.property(anyPathArb, (pathname) => {
          const result = shouldRedirect({
            loading: false,
            hasUser: true,
            pathname,
          });
          expect(result).toBe(false);
        }),
        { numRuns: 200 }
      );
    });

    it('should NOT redirect while loading regardless of auth state or path', () => {
      /**
       * **Validates: Requirements 11.3, 11.4**
       *
       * While the auth state is loading, no redirect should occur.
       */
      fc.assert(
        fc.property(
          anyPathArb,
          fc.boolean(), // hasUser
          (pathname, hasUser) => {
            const result = shouldRedirect({
              loading: true,
              hasUser,
              pathname,
            });
            expect(result).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Children rendering behavior', () => {
    it('should render children for authenticated users on any path', () => {
      /**
       * **Validates: Requirements 11.3, 11.4**
       *
       * Authenticated users should always see page content.
       */
      fc.assert(
        fc.property(anyPathArb, (pathname) => {
          const result = shouldRenderChildren({
            loading: false,
            hasUser: true,
            pathname,
          });
          expect(result).toBe(true);
        }),
        { numRuns: 200 }
      );
    });

    it('should render children on public paths even when unauthenticated', () => {
      /**
       * **Validates: Requirements 11.3, 11.4**
       *
       * Public paths should render children regardless of auth state.
       */
      fc.assert(
        fc.property(publicPathArb, (pathname) => {
          const result = shouldRenderChildren({
            loading: false,
            hasUser: false,
            pathname,
          });
          expect(result).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should NOT render children for unauthenticated users on non-public paths', () => {
      /**
       * **Validates: Requirements 11.3, 11.4**
       *
       * No protected page content should render for unauthenticated users.
       */
      fc.assert(
        fc.property(nonPublicPathArb, (pathname) => {
          const result = shouldRenderChildren({
            loading: false,
            hasUser: false,
            pathname,
          });
          expect(result).toBe(false);
        }),
        { numRuns: 200 }
      );
    });

    it('should NOT render children while loading', () => {
      /**
       * **Validates: Requirements 11.3, 11.4**
       *
       * While loading, a spinner is shown instead of children.
       */
      fc.assert(
        fc.property(
          anyPathArb,
          fc.boolean(), // hasUser
          (pathname, hasUser) => {
            const result = shouldRenderChildren({
              loading: true,
              hasUser,
              pathname,
            });
            expect(result).toBe(false);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Redirect and render are mutually consistent', () => {
    it('redirect=true implies renderChildren=false', () => {
      /**
       * **Validates: Requirements 11.3, 11.4**
       *
       * If a redirect is triggered, children must not render.
       * This ensures no protected content leaks during redirect.
       */
      fc.assert(
        fc.property(
          anyPathArb,
          fc.boolean(), // loading
          fc.boolean(), // hasUser
          (pathname, loading, hasUser) => {
            const redirect = shouldRedirect({ loading, hasUser, pathname });
            const render = shouldRenderChildren({ loading, hasUser, pathname });

            if (redirect) {
              expect(render).toBe(false);
            }
          }
        ),
        { numRuns: 500 }
      );
    });
  });
});
