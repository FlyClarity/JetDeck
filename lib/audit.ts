import { prisma } from "@/lib/prisma";
import { getTenantContext } from "@/lib/auth";
import type { Prisma } from "@/lib/generated/prisma/client";

// Deliberately thin, per OPS_BUILD_PLAN.md's Phase 1 — not middleware
// wrapping every route, just an explicit call from the handful of new
// server actions each phase adds where the audit trail actually matters
// (crew record changes, document uploads, compliance overrides). Widen the
// call sites as later phases add actions worth auditing, rather than
// retrofitting every existing route as a prerequisite.
//
// Best-effort: a failed write here shouldn't roll back or fail the real
// action it's describing, so errors are swallowed (and logged) rather than
// thrown — matches the SavedPassenger auto-save pattern in lib/manifest.ts.
export async function logAction(entry: {
  operatorId: string;
  action: string;
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { userId } = await getTenantContext();

    await prisma.auditLog.create({
      data: {
        operatorId: entry.operatorId,
        actorId: userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        detail: entry.detail as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    console.error(`Failed to write audit log for ${entry.action} on ${entry.entityType}:${entry.entityId}`, err);
  }
}
