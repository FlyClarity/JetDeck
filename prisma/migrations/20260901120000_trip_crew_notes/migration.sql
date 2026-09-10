-- Free-text crew stand-in for brokered trips, where the actual crew are
-- the source operator's employees, not a CrewMember on this operator's
-- own roster.
ALTER TABLE "Trip" ADD COLUMN "crewNotes" TEXT;
