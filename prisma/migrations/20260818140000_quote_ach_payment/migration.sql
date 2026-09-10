-- ACH as a third payment method, still requiring the backup card hold.
-- Tracked as its own PaymentIntent/status separate from the card hold's
-- stripePaymentIntentId/cardHoldStatus, since ACH is a real direct debit
-- with its own multi-day settlement window rather than a manual-capture
-- authorization.

ALTER TABLE "Quote" ADD COLUMN "achPaymentIntentId" TEXT;
ALTER TABLE "Quote" ADD COLUMN "achPaymentStatus" TEXT;
ALTER TABLE "Quote" ADD COLUMN "achConfirmedAt" TIMESTAMP(3);
