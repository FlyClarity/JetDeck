-- Two-step booking flow: client "Request to Book" (non-binding) is now a
-- separate step from the legal "I Accept" signature, with an operator
-- availability review in between. New "approved" status sits between
-- pending_confirmation and accepted; requestedAt/approvedAt track the two
-- new transitions the same way acceptedAt/declinedAt/cancelledAt already do.
ALTER TABLE "Quote" ADD COLUMN "requestedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN "approvedAt" TIMESTAMP(3);
