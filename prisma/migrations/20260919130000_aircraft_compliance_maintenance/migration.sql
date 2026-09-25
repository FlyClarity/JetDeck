-- OPS_BUILD_PLAN.md Phase 1: aircraft compliance reference data and a
-- manual maintenance-item log. Purely additive — no existing table or
-- column is touched.

CREATE TABLE "AircraftCompliance" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "airframeHours" DOUBLE PRECISION,
    "airframeCycles" INTEGER,
    "engineNotes" TEXT,
    "hoursAsOf" TIMESTAMP(3),
    "opSpecs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "insuranceCarrier" TEXT,
    "insurancePolicyNumber" TEXT,
    "insuranceExpiry" TIMESTAMP(3),
    "registrationExpiry" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AircraftCompliance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AircraftCompliance_aircraftId_key" ON "AircraftCompliance"("aircraftId");

ALTER TABLE "AircraftCompliance" ADD CONSTRAINT "AircraftCompliance_operatorId_fkey"
    FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AircraftCompliance" ADD CONSTRAINT "AircraftCompliance_aircraftId_fkey"
    FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MaintenanceItem" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAtHours" DOUBLE PRECISION,
    "dueAtDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedAtHours" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaintenanceItem_operatorId_aircraftId_idx" ON "MaintenanceItem"("operatorId", "aircraftId");

ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_operatorId_fkey"
    FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaintenanceItem" ADD CONSTRAINT "MaintenanceItem_aircraftId_fkey"
    FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
