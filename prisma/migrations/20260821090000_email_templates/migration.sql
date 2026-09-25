-- Editable client-email templates for the three core booking-lifecycle
-- emails (quote sent, booking confirmed, booking cancelled). Nullable —
-- null means "use the built-in default" (see lib/email-templates.ts), so
-- every operator keeps getting the same email they always got until they
-- actually customize one.
ALTER TABLE "Operator" ADD COLUMN "quoteSentSubject" TEXT;
ALTER TABLE "Operator" ADD COLUMN "quoteSentBody" TEXT;
ALTER TABLE "Operator" ADD COLUMN "bookingConfirmedSubject" TEXT;
ALTER TABLE "Operator" ADD COLUMN "bookingConfirmedBody" TEXT;
ALTER TABLE "Operator" ADD COLUMN "bookingCancelledSubject" TEXT;
ALTER TABLE "Operator" ADD COLUMN "bookingCancelledBody" TEXT;
