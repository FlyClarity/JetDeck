-- Aircraft photo gallery + flexible amenity list, replacing the single
-- hasWifi boolean. Existing hasWifi=true aircraft are backfilled with
-- "wifi" in the new amenities array before the column is dropped, so no
-- data is silently lost in the switch.
ALTER TABLE "Aircraft" ADD COLUMN "photos" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Aircraft" ADD COLUMN "amenities" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "Aircraft" SET "amenities" = ARRAY['wifi'] WHERE "hasWifi" = true;

ALTER TABLE "Aircraft" DROP COLUMN "hasWifi";
