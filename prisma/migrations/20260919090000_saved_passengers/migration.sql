-- Remembers a passenger's info under the client they flew as a guest of,
-- so ops doesn't have to retype the same name/DOB/ID every time the same
-- person books again. Auto-maintained from Passenger rows as trips are
-- completed (see applyPassengerFormUpdate in lib/manifest.ts), searchable
-- operator-wide when adding a passenger to a new trip.
CREATE TABLE "SavedPassenger" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "contactId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "weightLbs" INTEGER,
    "idType" TEXT,
    "idNumber" TEXT,
    "idExpiry" TIMESTAMP(3),
    "idImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedPassenger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SavedPassenger_operatorId_contactId_firstName_lastName_dat_key"
    ON "SavedPassenger"("operatorId", "contactId", "firstName", "lastName", "dateOfBirth");

CREATE INDEX "SavedPassenger_operatorId_lastName_idx" ON "SavedPassenger"("operatorId", "lastName");

ALTER TABLE "SavedPassenger" ADD CONSTRAINT "SavedPassenger_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
