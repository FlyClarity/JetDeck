-- Split the single crewNotes blob into named fields, per the operator's
-- request for separate typable Captain/Co-Pilot/Cabin Host fields on a
-- brokered trip.
ALTER TABLE "Trip" ADD COLUMN "brokeredCaptainName" TEXT;
ALTER TABLE "Trip" ADD COLUMN "brokeredCoPilotName" TEXT;
ALTER TABLE "Trip" ADD COLUMN "brokeredCabinHostName" TEXT;

-- Best-effort preserve whatever was typed into the old single field —
-- it's only ever been live for one round, so this is just a courtesy,
-- not a real structured migration.
UPDATE "Trip" SET "brokeredCaptainName" = "crewNotes" WHERE "crewNotes" IS NOT NULL;

ALTER TABLE "Trip" DROP COLUMN "crewNotes";

-- New terminal stage for brokered trips — see Trip.status's schema
-- comment. No existing rows to migrate into it (this stage didn't exist
-- before now).
