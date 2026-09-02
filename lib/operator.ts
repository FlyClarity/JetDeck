import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/auth";

export async function getCurrentOperator() {
  const { clerkOrgId } = await getTenantContext();

  if (!clerkOrgId) {
    return null;
  }

  return prisma.operator.findUnique({
    where: { clerkOrgId },
  });
}
