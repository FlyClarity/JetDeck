-- Wire vs credit card payment method choice, chosen by the client at the
-- signature step. cardHoldAmount snapshots the actual dollar amount held via
-- Stripe (including the CC processing fee surcharge when paid by card), and
-- wireConfirmedAt is set by the operator once a wire payment actually shows
-- up (see markWireReceived in lib/booking-server.ts).
ALTER TABLE "Quote" ADD COLUMN "paymentMethod" TEXT;
ALTER TABLE "Quote" ADD COLUMN "cardHoldAmount" DOUBLE PRECISION;
ALTER TABLE "Quote" ADD COLUMN "wireConfirmedAt" TIMESTAMP(3);
