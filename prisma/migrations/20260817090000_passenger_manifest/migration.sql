-- First slice of the Ops Build Brief, reprioritized: passenger manifest
-- collection. Passenger holds every passenger on a Trip (lead and
-- additional, each with their own token); ManifestReminder tracks which
-- reminder thresholds have already fired for a trip so the cron sweep
-- never re-sends one.

CREATE TABLE "Passenger" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "weightLbs" INTEGER,
    "idType" TEXT,
    "idNumber" TEXT,
    "idExpiry" TIMESTAMP(3),
    "idImageUrl" TEXT,
    "ktn" TEXT,
    "specialRequests" TEXT,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Passenger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Passenger_token_key" ON "Passenger"("token");

ALTER TABLE "Passenger" ADD CONSTRAINT "Passenger_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ManifestReminder" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManifestReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManifestReminder_tripId_type_key" ON "ManifestReminder"("tripId", "type");

ALTER TABLE "ManifestReminder" ADD CONSTRAINT "ManifestReminder_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
