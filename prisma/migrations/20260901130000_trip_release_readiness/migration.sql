-- Board redesign: crew assignment folds into "In Review" instead of being
-- its own stage, and "ops_approved" is renamed "ready_for_release" now
-- that reaching it requires more than just the Ops Review checklist.
UPDATE "Trip" SET "status" = 'ops_review' WHERE "status" = 'crew_assigned';
UPDATE "Trip" SET "status" = 'ready_for_release' WHERE "status" = 'ops_approved';

-- Ready-for-release prerequisites and Landed block/flight time entry.
ALTER TABLE "Trip" ADD COLUMN "itinerarySentAt" TIMESTAMP(3);
ALTER TABLE "Trip" ADD COLUMN "crewAcknowledgedAt" TIMESTAMP(3);
ALTER TABLE "Trip" ADD COLUMN "actualBlockHours" DOUBLE PRECISION;
ALTER TABLE "Trip" ADD COLUMN "actualFlightHours" DOUBLE PRECISION;
