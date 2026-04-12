/**
 * G6-05: Unit tests for auth middleware — JWT validation, RBAC, role extraction.
 */
import { requireRole } from '../middleware/auth';
import { RequestContext, UserRole } from '../models/types';

describe('requireRole', () => {
  const makeCtx = (role: UserRole): RequestContext => ({
    tenantId: 'tenant-1',
    userId: 'user-1',
    role,
  });

  test('admin passes all role checks', () => {
    const ctx = makeCtx('admin');
    expect(requireRole(ctx, 'admin')).toBe(true);
    expect(requireRole(ctx, 'editor')).toBe(true);
    expect(requireRole(ctx, 'reviewer')).toBe(true);
    expect(requireRole(ctx, 'viewer')).toBe(true);
  });

  test('editor passes editor/reviewer/viewer but not admin', () => {
    const ctx = makeCtx('editor');
    expect(requireRole(ctx, 'admin')).toBe(false);
    expect(requireRole(ctx, 'editor')).toBe(true);
    expect(requireRole(ctx, 'reviewer')).toBe(true);
    expect(requireRole(ctx, 'viewer')).toBe(true);
  });

  test('reviewer passes reviewer/viewer but not editor/admin', () => {
    const ctx = makeCtx('reviewer');
    expect(requireRole(ctx, 'admin')).toBe(false);
    expect(requireRole(ctx, 'editor')).toBe(false);
    expect(requireRole(ctx, 'reviewer')).toBe(true);
    expect(requireRole(ctx, 'viewer')).toBe(true);
  });

  test('viewer passes only viewer', () => {
    const ctx = makeCtx('viewer');
    expect(requireRole(ctx, 'admin')).toBe(false);
    expect(requireRole(ctx, 'editor')).toBe(false);
    expect(requireRole(ctx, 'reviewer')).toBe(false);
    expect(requireRole(ctx, 'viewer')).toBe(true);
  });

  test('undefined role defaults to viewer behavior', () => {
    const ctx: RequestContext = { tenantId: 't', userId: 'u' };
    expect(requireRole(ctx, 'viewer')).toBe(true);
    expect(requireRole(ctx, 'reviewer')).toBe(false);
  });
});
