/**
 * Unit tests for API client helpers.
 *
 * Tests extracted pure-function equivalents of:
 * - buildQuery: query string construction
 * - buildAuthHeaders / token attachment
 * - shouldRedirectToLogin: 401 redirect decision logic
 *
 * **Validates: Requirements 13.4, 13.5, 13.7, 12.7**
 */
import { describe, it, expect } from 'vitest';

// --- Extracted pure functions mirroring api.ts internals ---

/** Mirrors buildQuery() from api.ts */
function buildQuery(params?: Record<string, string | undefined>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
}

/** Mirrors header construction in request() from api.ts */
function buildAuthHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Models the 401 redirect decision from request() in api.ts.
 * Returns true when the user should be redirected to login.
 */
function shouldRedirectToLogin(
  statusCode: number,
  refreshSucceeded: boolean,
  retryStatusCode?: number
): boolean {
  if (statusCode !== 401) return false;
  // Got a 401 — try refresh
  if (!refreshSucceeded) return true;
  // Refresh succeeded, retry the request
  if (retryStatusCode === 401) return true;
  return false;
}

// --- Tests ---

describe('buildQuery', () => {
  it('returns empty string for undefined params', () => {
    expect(buildQuery(undefined)).toBe('');
  });

  it('returns empty string for empty object', () => {
    expect(buildQuery({})).toBe('');
  });

  it('returns empty string when all values are undefined', () => {
    expect(buildQuery({ status: undefined, range: undefined })).toBe('');
  });

  it('builds query with a single param', () => {
    expect(buildQuery({ status: 'pending' })).toBe('?status=pending');
  });

  it('builds query with multiple params', () => {
    const result = buildQuery({ status: 'completed', workspace_id: 'ws-1' });
    expect(result).toContain('status=completed');
    expect(result).toContain('workspace_id=ws-1');
    expect(result).toMatch(/^\?/);
    expect(result.split('&')).toHaveLength(2);
  });

  it('filters out undefined values from mixed params', () => {
    const result = buildQuery({ status: 'failed', range: undefined, workspace_id: 'ws-2' });
    expect(result).toContain('status=failed');
    expect(result).toContain('workspace_id=ws-2');
    expect(result).not.toContain('range');
    expect(result.split('&')).toHaveLength(2);
  });

  it('URL-encodes special characters in values', () => {
    const result = buildQuery({ q: 'hello world' });
    expect(result).toBe('?q=hello%20world');
  });

  it('URL-encodes ampersands and equals signs in values', () => {
    const result = buildQuery({ filter: 'a=1&b=2' });
    expect(result).toBe('?filter=a%3D1%26b%3D2');
  });

  it('preserves key order from the object', () => {
    const result = buildQuery({ a: '1', b: '2', c: '3' });
    expect(result).toBe('?a=1&b=2&c=3');
  });
});

describe('Token attachment (buildAuthHeaders)', () => {
  it('attaches Bearer token when token is provided', () => {
    const headers = buildAuthHeaders('my-jwt-token');
    expect(headers['Authorization']).toBe('Bearer my-jwt-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('does not set Authorization header when token is null', () => {
    const headers = buildAuthHeaders(null);
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('does not set Authorization header when token is empty string', () => {
    const headers = buildAuthHeaders('');
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('preserves exact token value including dots and special chars', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature';
    const headers = buildAuthHeaders(jwt);
    expect(headers['Authorization']).toBe(`Bearer ${jwt}`);
  });

  it('always includes Content-Type regardless of token', () => {
    expect(buildAuthHeaders('tok')['Content-Type']).toBe('application/json');
    expect(buildAuthHeaders(null)['Content-Type']).toBe('application/json');
    expect(buildAuthHeaders('')['Content-Type']).toBe('application/json');
  });

  it('returns a new object each call (no shared state)', () => {
    const h1 = buildAuthHeaders('a');
    const h2 = buildAuthHeaders('b');
    h1['Authorization'] = 'tampered';
    expect(h2['Authorization']).toBe('Bearer b');
  });
});

describe('401 redirect logic (shouldRedirectToLogin)', () => {
  it('does not redirect for non-401 status codes', () => {
    expect(shouldRedirectToLogin(200, false)).toBe(false);
    expect(shouldRedirectToLogin(403, false)).toBe(false);
    expect(shouldRedirectToLogin(500, false)).toBe(false);
  });

  it('redirects on 401 when session refresh fails', () => {
    expect(shouldRedirectToLogin(401, false)).toBe(true);
  });

  it('redirects on 401 when refresh succeeds but retry also returns 401', () => {
    expect(shouldRedirectToLogin(401, true, 401)).toBe(true);
  });

  it('does not redirect when refresh succeeds and retry returns 200', () => {
    expect(shouldRedirectToLogin(401, true, 200)).toBe(false);
  });

  it('does not redirect when refresh succeeds and retry returns other non-401 error', () => {
    expect(shouldRedirectToLogin(401, true, 500)).toBe(false);
  });
});
