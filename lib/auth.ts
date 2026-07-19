import { auth } from "@clerk/nextjs/server";

/**
 * Enforces auth directly (resource-based check), rather than relying solely
 * on middleware path matching — Clerk's own guidance, since middleware
 * matchers can drift out of sync with actual routes.
 */
export async function getTenantContext() {
  const { userId, orgId, orgRole } = await auth.protect();

  return {
    userId,
    clerkOrgId: orgId ?? null,
    orgRole: orgRole ?? null,
  };
}
