-- Client-visible notes, distinct from the existing operator-only
-- internalNotes — shown on the client-facing quote page (/q/[token]).
ALTER TABLE "Quote" ADD COLUMN "clientNotes" TEXT;
