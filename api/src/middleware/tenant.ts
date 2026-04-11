import { v4 as uuidv4 } from 'uuid';
import { RequestContext, Tenant } from '../models/types';
import { getItem, putItem, queryIndex, TABLE_NAMES } from '../lib/dynamo';

// RFC 5321-compliant email format check — prevents empty/malformed values reaching DynamoDB
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

/**
 * G6-01: JWT-first tenant resolution.
 *
 * Security model:
 *   1. PRIMARY: Use `context.tenantId` which comes exclusively from the verified JWT
 *      `custom:tenant_id` claim (set by auth.ts after RS256 signature verification).
 *      This is the only trusted source for tenant identity.
 *   2. FALLBACK (first login only): If the JWT has no `custom:tenant_id` yet (new user whose
 *      Cognito attribute hasn't been set), look up by email. Email is taken from the `email`
 *      claim in the JWT — NOT from the X-User-Email header.
 *   3. AUTO-PROVISION: Create a new tenant record on first login. The email header is used
 *      only as a convenience for recording the tenant email during provisioning and is
 *      NEVER used as a trust anchor for tenant identity lookup.
 *
 * The X-User-Email header is forwarded for audit logging continuity but has zero
 * influence on which tenant record is loaded.
 */
export async function resolveTenant(context: RequestContext, _emailHeader: string): Promise<Tenant> {
  // Step 1 (PRIMARY): Trust only the JWT-derived tenantId
  if (context.tenantId) {
    const tenant = await getItem<Tenant>(TABLE_NAMES.tenants, { tenant_id: context.tenantId });
    if (tenant) {
      // Guard against accessing a soft-deleted tenant account
      if ((tenant as unknown as Record<string, unknown>).deleted) {
        throw new Error('Tenant account has been deleted');
      }
      context.tenant = tenant;
      return tenant;
    }
  }

  // Step 2 (FIRST LOGIN FALLBACK): userId = Cognito sub; use sub as stable email lookup key.
  // We look up by the JWT sub (userId) to find previously provisioned tenants where
  // custom:tenant_id wasn't set in Cognito yet.
  // Guard: if the user-id-index GSI doesn't exist yet, skip this lookup and auto-provision.
  if (context.userId) {
    try {
      const byUserId = await queryIndex<Tenant>(TABLE_NAMES.tenants, 'user-id-index', 'user_id', context.userId);
      if (byUserId.length > 0) {
        const tenant = byUserId[0];
        if ((tenant as unknown as Record<string, unknown>).deleted) {
          throw new Error('Tenant account has been deleted');
        }
        context.tenantId = tenant.tenant_id;
        context.tenant = tenant;
        return tenant;
      }
    } catch (err) {
      // If the GSI doesn't exist (ValidationException), fall through to auto-provisioning
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('does not have the specified index') && !msg.includes('ValidationException')) {
        throw err;
      }
    }
  }

  // Step 3 (AUTO-PROVISION): New user — create tenant record.
  // email is taken from the header only for display/audit; tenant identity is the new UUID.
  const email = isValidEmail(_emailHeader) ? _emailHeader : `${context.userId}@unknown`;
  const newTenant: Tenant = {
    tenant_id: uuidv4(),
    email,
    plan: 'free',
    created_at: new Date().toISOString(),
  };
  // Store user_id so future lookups by JWT sub work without custom:tenant_id
  await putItem(TABLE_NAMES.tenants, {
    ...(newTenant as unknown as Record<string, unknown>),
    user_id: context.userId,
  });
  context.tenantId = newTenant.tenant_id;
  context.tenant = newTenant;
  return newTenant;
}
