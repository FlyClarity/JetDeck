-- clientNotes moves from Quote (shared across every option) to QuoteOption
-- (specific to whichever aircraft/itinerary that option represents) — a
-- quote with multiple options needs different client-facing notes per
-- option (e.g. catering differs by aircraft), not one note for the whole
-- quote.
ALTER TABLE "QuoteOption" ADD COLUMN "clientNotes" TEXT;

-- Backfill: copy each quote's existing note onto every one of its options
-- (safest default — we don't know which option it was "meant" for, and
-- copying preserves the content rather than silently dropping it; the
-- operator can differentiate per-option going forward).
UPDATE "QuoteOption" qo
SET "clientNotes" = q."clientNotes"
FROM "Quote" q
WHERE qo."quoteId" = q."id" AND q."clientNotes" IS NOT NULL;

ALTER TABLE "Quote" DROP COLUMN "clientNotes";
