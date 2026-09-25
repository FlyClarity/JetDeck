-- Crew roster + assignment (Ops Build Brief Steps 22/24). CrewMember is the
-- operator's pilot/crew roster; TripCrewAssignment links roster members to
-- a Trip, snapshotting their role at assignment time.

CREATE TABLE "CrewMember" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewMember_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CrewMember" ADD CONSTRAINT "CrewMember_operatorId_fkey"
    FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TripCrewAssignment" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "roleOnTrip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripCrewAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TripCrewAssignment_tripId_crewId_key" ON "TripCrewAssignment"("tripId", "crewId");

ALTER TABLE "TripCrewAssignment" ADD CONSTRAINT "TripCrewAssignment_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TripCrewAssignment" ADD CONSTRAINT "TripCrewAssignment_crewId_fkey"
    FOREIGN KEY ("crewId") REFERENCES "CrewMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
