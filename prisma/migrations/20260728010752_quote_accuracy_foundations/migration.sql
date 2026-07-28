-- AlterTable
ALTER TABLE "Operator" ADD COLUMN "defaultBlockTimeBufferHours" DOUBLE PRECISION NOT NULL DEFAULT 0.2;
ALTER TABLE "Operator" ADD COLUMN "defaultOvernightFee" DOUBLE PRECISION NOT NULL DEFAULT 1500;

-- AlterTable
ALTER TABLE "Aircraft" ADD COLUMN "cruiseSpeedKts" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "returnsToHomeBase" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Quote" ADD COLUMN "overnightNights" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Quote" ADD COLUMN "overnightFee" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Airport" (
    "icao" TEXT NOT NULL,
    "iata" TEXT,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "elevation" INTEGER,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Airport_pkey" PRIMARY KEY ("icao")
);
