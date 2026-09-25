-- Crew qualification tracking (Chief Pilot sign-off + certificate expiry
-- safety net) for the Ops Review checklist's crew check.
ALTER TABLE "CrewMember" ADD COLUMN "qualified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CrewMember" ADD COLUMN "medicalExpiry" TIMESTAMP(3);
ALTER TABLE "CrewMember" ADD COLUMN "trainingExpiry" TIMESTAMP(3);

-- Aircraft maintenance/downtime windows, for the Ops Review checklist's
-- "aircraft available" check.
CREATE TABLE "AircraftDowntime" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "aircraftId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AircraftDowntime_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AircraftDowntime" ADD CONSTRAINT "AircraftDowntime_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AircraftDowntime" ADD CONSTRAINT "AircraftDowntime_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
