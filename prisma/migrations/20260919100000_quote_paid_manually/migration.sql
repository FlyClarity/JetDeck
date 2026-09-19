-- A manual escape hatch for a quote with no paymentMethod on file at all —
-- i.e. one booked before online payment tracking existed here, so there's
-- no wire/ACH/card-hold trail for the operator to confirm against. Set via
-- "Mark Paid Manually" on the quote/trip detail pages
-- (markPaymentReceivedManually in lib/booking-server.ts), which refuses to
-- set this once paymentMethod is actually populated.
ALTER TABLE "Quote" ADD COLUMN "paidManuallyAt" TIMESTAMP(3);
