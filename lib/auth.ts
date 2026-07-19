import { auth } from "@clerk/nextjs/server";

export async function getTenantContext() {
  const { userId, orgId, orgRole } = await auth();

  return {
    userId,
    clerkOrgId: orgId ?? null,
    orgRole: orgRole ?? null,
  };
}
