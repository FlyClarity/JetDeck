-- "Options": a Quote can now hold multiple priced itinerary variations
-- (e.g. same trip from a different departure airport, or a different
-- aircraft) that the client chooses between. Everything that used to be a
-- flat pricing/itinerary/aircraft field directly on Quote moves to a new
-- child table, QuoteOption. Every existing Quote is backfilled with
-- exactly one QuoteOption carrying its current values, and Quote.
-- selectedOptionId is pointed at it — so no existing quote (sent, accepted,
-- with a live Stripe hold, whatever its state) changes behavior. Only new
-- quotes built with more than one option will ever have selectedOptionId
-- pointing at anything the client actually chose between.

-- CreateTable
CREATE TABLE "QuoteOption" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Option A',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "aircraftId" TEXT,
    "fleetSource" TEXT NOT NULL DEFAULT 'own_fleet',
    "brokeredAircraftId" TEXT,
    "itinerary" JSONB NOT NULL,
    "flightHours" DOUBLE PRECISION NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "repoHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repoRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "returnsToHomeBase" BOOLEAN NOT NULL DEFAULT true,
    "overnightNights" INTEGER NOT NULL DEFAULT 0,
    "overnightFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "landingFees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "handlingFees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "additionalFees" JSONB NOT NULL DEFAULT '[]',
    "fetTax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountNote" TEXT,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "depositAmount" DOUBLE PRECISION,
    "wholesaleCost" DOUBLE PRECISION,
    "brokerMargin" DOUBLE PRECISION,
    "aiPriceSuggestion" DOUBLE PRECISION,
    "aiPriceReasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteOption_pkey" PRIMARY KEY ("id")
);

-- Backfill: one QuoteOption per existing Quote, carrying over its current
-- pricing/itinerary/aircraft values verbatim. id is a random 32-char hex
-- string (no format is enforced beyond being an opaque unique string, so
-- this doesn't need to look like a Prisma cuid).
INSERT INTO "QuoteOption" (
    "id", "quoteId", "label", "sortOrder",
    "aircraftId", "fleetSource", "brokeredAircraftId",
    "itinerary", "flightHours", "hourlyRate", "repoHours", "repoRate",
    "returnsToHomeBase", "overnightNights", "overnightFee",
    "landingFees", "handlingFees", "additionalFees", "fetTax",
    "discount", "discountNote", "subtotal", "total", "depositAmount",
    "wholesaleCost", "brokerMargin", "aiPriceSuggestion", "aiPriceReasoning",
    "createdAt", "updatedAt"
)
SELECT
    md5(random()::text || clock_timestamp()::text || q."id"),
    q."id", 'Option A', 0,
    q."aircraftId", q."fleetSource", q."brokeredAircraftId",
    q."itinerary", q."flightHours", q."hourlyRate", q."repoHours", q."repoRate",
    q."returnsToHomeBase", q."overnightNights", q."overnightFee",
    q."landingFees", q."handlingFees", q."additionalFees", q."fetTax",
    q."discount", q."discountNote", q."subtotal", q."total", q."depositAmount",
    q."wholesaleCost", q."brokerMargin", q."aiPriceSuggestion", q."aiPriceReasoning",
    q."createdAt", q."updatedAt"
FROM "Quote" q;

-- AlterTable: point each Quote at its backfilled option
ALTER TABLE "Quote" ADD COLUMN "selectedOptionId" TEXT;

UPDATE "Quote" q
SET "selectedOptionId" = qo."id"
FROM "QuoteOption" qo
WHERE qo."quoteId" = q."id";

-- Drop the now-migrated columns from Quote. Their FK constraints
-- (aircraftId, brokeredAircraftId) are dropped automatically along with
-- the columns.
ALTER TABLE "Quote" DROP COLUMN "aircraftId";
ALTER TABLE "Quote" DROP COLUMN "fleetSource";
ALTER TABLE "Quote" DROP COLUMN "brokeredAircraftId";
ALTER TABLE "Quote" DROP COLUMN "itinerary";
ALTER TABLE "Quote" DROP COLUMN "flightHours";
ALTER TABLE "Quote" DROP COLUMN "hourlyRate";
ALTER TABLE "Quote" DROP COLUMN "repoHours";
ALTER TABLE "Quote" DROP COLUMN "repoRate";
ALTER TABLE "Quote" DROP COLUMN "returnsToHomeBase";
ALTER TABLE "Quote" DROP COLUMN "overnightNights";
ALTER TABLE "Quote" DROP COLUMN "overnightFee";
ALTER TABLE "Quote" DROP COLUMN "landingFees";
ALTER TABLE "Quote" DROP COLUMN "handlingFees";
ALTER TABLE "Quote" DROP COLUMN "additionalFees";
ALTER TABLE "Quote" DROP COLUMN "fetTax";
ALTER TABLE "Quote" DROP COLUMN "discount";
ALTER TABLE "Quote" DROP COLUMN "discountNote";
ALTER TABLE "Quote" DROP COLUMN "subtotal";
ALTER TABLE "Quote" DROP COLUMN "total";
ALTER TABLE "Quote" DROP COLUMN "depositAmount";
ALTER TABLE "Quote" DROP COLUMN "wholesaleCost";
ALTER TABLE "Quote" DROP COLUMN "brokerMargin";
ALTER TABLE "Quote" DROP COLUMN "aiPriceSuggestion";
ALTER TABLE "Quote" DROP COLUMN "aiPriceReasoning";

-- AddForeignKey
ALTER TABLE "QuoteOption" ADD CONSTRAINT "QuoteOption_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuoteOption" ADD CONSTRAINT "QuoteOption_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "QuoteOption" ADD CONSTRAINT "QuoteOption_brokeredAircraftId_fkey" FOREIGN KEY ("brokeredAircraftId") REFERENCES "BrokeredAircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_selectedOptionId_fkey" FOREIGN KEY ("selectedOptionId") REFERENCES "QuoteOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
