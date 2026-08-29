-- Which legs a passenger flies, by index into the itinerary's stored leg
-- array. Empty (the default) means every revenue leg.
ALTER TABLE "Passenger" ADD COLUMN "legIndexes" INTEGER[] NOT NULL DEFAULT '{}';
