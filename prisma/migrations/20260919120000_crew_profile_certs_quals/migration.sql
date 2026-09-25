-- OPS_BUILD_PLAN.md Phase 1: extend CrewMember toward a full profile, and
-- add CrewCertificate / CrewQualification as new, purely additive tables.
-- Nothing here changes existing behavior — no existing column is touched,
-- dropped, or backfilled.

ALTER TABLE "CrewMember"
    ADD COLUMN "address" TEXT,
    ADD COLUMN "emergencyContactName" TEXT,
    ADD COLUMN "emergencyContactPhone" TEXT,
    ADD COLUMN "employmentType" TEXT,
    ADD COLUMN "hireDate" TIMESTAMP(3),
    ADD COLUMN "terminationDate" TIMESTAMP(3),
    ADD COLUMN "otherCommercialHoursQuarterly" DOUBLE PRECISION,
    ADD COLUMN "otherCommercialHoursAnnual" DOUBLE PRECISION,
    ADD COLUMN "otherCommercialHoursAsOf" TIMESTAMP(3);

CREATE TABLE "CrewCertificate" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "certType" TEXT NOT NULL,
    "certNumber" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiry" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewCertificate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrewCertificate_operatorId_crewId_idx" ON "CrewCertificate"("operatorId", "crewId");

ALTER TABLE "CrewCertificate" ADD CONSTRAINT "CrewCertificate_crewId_fkey"
    FOREIGN KEY ("crewId") REFERENCES "CrewMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CrewQualification" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "qualifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewQualification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrewQualification_crewId_category_key" ON "CrewQualification"("crewId", "category");

CREATE INDEX "CrewQualification_operatorId_category_idx" ON "CrewQualification"("operatorId", "category");

ALTER TABLE "CrewQualification" ADD CONSTRAINT "CrewQualification_crewId_fkey"
    FOREIGN KEY ("crewId") REFERENCES "CrewMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
