-- "Send to Ops" handoff: a Trip is no longer visible on the Ops Board/
-- Trips list/Calendar until sales explicitly reviews and sends it. Default
-- is false for all new inserts, but every existing Trip is grandfathered in
-- so nothing already visible in Ops disappears out from under anyone.
ALTER TABLE "Trip" ADD COLUMN "sentToOps" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Trip" SET "sentToOps" = true;

-- "awaiting_payment" is no longer a pipeline stage — payment is tracked
-- separately (derived from the linked Quote) instead of gating entry into
-- the Ops pipeline. Fold any trip still sitting there into "confirmed".
UPDATE "Trip" SET "status" = 'confirmed' WHERE "status" = 'awaiting_payment';
