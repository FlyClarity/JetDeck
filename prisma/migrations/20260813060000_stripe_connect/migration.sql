-- AlterTable
ALTER TABLE "Operator" ADD COLUMN "stripeAccountId" TEXT;
ALTER TABLE "Operator" ADD COLUMN "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Operator" ADD COLUMN "ccProcessingFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 3.0;
