-- OPS_BUILD_PLAN.md Phase 1: document/manual library with version history
-- and a crew acknowledgment trail. Purely additive.

CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "requiresAcknowledgment" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Document" ADD CONSTRAINT "Document_operatorId_fkey"
    FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "notes" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentVersion_operatorId_documentId_idx" ON "DocumentVersion"("operatorId", "documentId");

ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ManualAcknowledgment" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "documentVersionId" TEXT,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL DEFAULT 'manual_override',
    "recordedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualAcknowledgment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManualAcknowledgment_operatorId_documentId_idx" ON "ManualAcknowledgment"("operatorId", "documentId");

CREATE INDEX "ManualAcknowledgment_operatorId_crewId_idx" ON "ManualAcknowledgment"("operatorId", "crewId");

ALTER TABLE "ManualAcknowledgment" ADD CONSTRAINT "ManualAcknowledgment_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManualAcknowledgment" ADD CONSTRAINT "ManualAcknowledgment_crewId_fkey"
    FOREIGN KEY ("crewId") REFERENCES "CrewMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManualAcknowledgment" ADD CONSTRAINT "ManualAcknowledgment_documentVersionId_fkey"
    FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
