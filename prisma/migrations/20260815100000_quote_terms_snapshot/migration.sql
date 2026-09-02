-- Snapshots Operator.termsText onto the Quote at send time, so an operator
-- editing their charter terms in Settings after a quote goes out can't
-- retroactively change what a client sees or what acceptedTermsHash records
-- them as having agreed to. Null for quotes sent before this existed — those
-- fall back to the live Operator.termsText, same as before this migration.
ALTER TABLE "Quote" ADD COLUMN "termsTextSnapshot" TEXT;
