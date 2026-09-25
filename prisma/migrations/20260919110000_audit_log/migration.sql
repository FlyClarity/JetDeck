-- An append-only record of a compliance-relevant action, written by
-- logAction (lib/audit.ts) — see AuditLog's schema comment. Phase 1 of
-- OPS_BUILD_PLAN.md's ops/compliance rebuild.
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_operatorId_entityType_entityId_idx" ON "AuditLog"("operatorId", "entityType", "entityId");

CREATE INDEX "AuditLog_operatorId_createdAt_idx" ON "AuditLog"("operatorId", "createdAt");
