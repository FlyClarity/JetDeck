-- Brokered aircraft get the same photos/amenities as owned fleet, shown on
-- the client quote page the same way.
ALTER TABLE "BrokeredAircraft" ADD COLUMN "photos" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "BrokeredAircraft" ADD COLUMN "amenities" TEXT[] NOT NULL DEFAULT '{}';
