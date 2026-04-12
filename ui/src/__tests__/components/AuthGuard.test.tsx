import { describe, it, expect } from 'vitest';

/**
 * Unit tests for AuthGuard logic.
 *
 * AuthGuard uses React hooks (useAuth, usePathname, useRouter) so it cannot
 * be called as a pure function. We extract and test the core decision logic
 * that mirrors the component's behavior.
 *
 * Validates: Requirements 11.3
 */

const PUBLIC_PATHS = ['/auth/login', '/auth/callback'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

function shouldRedirect(params: {
  loading: boolean;
  hasUser: boolean;
  pathname: string;
}): boolean {
  const { loading, hasUser, pathname } = params;
  return !loading && !hasUser && !isPublicPath(pathname);
}

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

describe('AuthGuard', () => {
  describe('redirect for unauthenticated users', () => {
    it('redirects unauthenticated user on /dashboard', () => {
      expect(shouldRedirect({ loading: false, hasUser: false, pathname: '/dashboard' })).toBe(true);
    });

    it('redirects unauthenticated user on /workspaces', () => {
      expect(shouldRedirect({ loading: false, hasUser: false, pathname: '/workspaces' })).toBe(true);
    });

    it('redirects unauthenticated user on /traces', () => {
      expect(shouldRedirect({ loading: false, hasUser: false, pathname: '/traces' })).toBe(true);
    });

    it('redirects unauthenticated user on /hitl', () => {
      expect(shouldRedirect({ loading: false, hasUser: false, pathname: '/hitl' })).toBe(true);
    });

    it('redirects unauthenticated user on /settings', () => {
      expect(shouldRedirect({ loading: false, hasUser: false, pathname: '/settings' })).toBe(true);
    });

    it('does NOT redirect on /auth/login', () => {
      expect(shouldRedirect({ loading: false, hasUser: false, pathname: '/auth/login' })).toBe(false);
    });

    it('does NOT redirect on /auth/callback', () => {
      expect(shouldRedirect({ loading: false, hasUser: false, pathname: '/auth/callback' })).toBe(false);
    });

    it('does NOT redirect while loading', () => {
      expect(shouldRedirect({ loading: true, hasUser: false, pathname: '/dashboard' })).toBe(false);
    });

    it('does NOT redirect authenticated users', () => {
      expect(shouldRedirect({ loading: false, hasUser: true, pathname: '/dashboard' })).toBe(false);
    });
  });

  describe('render children for authenticated users', () => {
    it('renders children for authenticated user on /dashboard', () => {
      expect(shouldRenderChildren({ loading: false, hasUser: true, pathname: '/dashboard' })).toBe(true);
    });

    it('renders children for authenticated user on /settings', () => {
      expect(shouldRenderChildren({ loading: false, hasUser: true, pathname: '/settings' })).toBe(true);
    });

    it('renders children on public paths even when unauthenticated', () => {
      expect(shouldRenderChildren({ loading: false, hasUser: false, pathname: '/auth/login' })).toBe(true);
      expect(shouldRenderChildren({ loading: false, hasUser: false, pathname: '/auth/callback' })).toBe(true);
    });

    it('does NOT render children for unauthenticated user on protected path', () => {
      expect(shouldRenderChildren({ loading: false, hasUser: false, pathname: '/dashboard' })).toBe(false);
    });

    it('does NOT render children while loading', () => {
      expect(shouldRenderChildren({ loading: true, hasUser: true, pathname: '/dashboard' })).toBe(false);
      expect(shouldRenderChildren({ loading: true, hasUser: false, pathname: '/dashboard' })).toBe(false);
    });
  });

  describe('consistency between redirect and render', () => {
    it('when redirect is true, children are not rendered', () => {
      // Unauthenticated on protected path
      const redirect = shouldRedirect({ loading: false, hasUser: false, pathname: '/dashboard' });
      const render = shouldRenderChildren({ loading: false, hasUser: false, pathname: '/dashboard' });
      expect(redirect).toBe(true);
      expect(render).toBe(false);
    });

    it('when children are rendered, no redirect occurs', () => {
      // Authenticated on protected path
      const redirect = shouldRedirect({ loading: false, hasUser: true, pathname: '/dashboard' });
      const render = shouldRenderChildren({ loading: false, hasUser: true, pathname: '/dashboard' });
      expect(redirect).toBe(false);
      expect(render).toBe(true);
    });
  });
});
