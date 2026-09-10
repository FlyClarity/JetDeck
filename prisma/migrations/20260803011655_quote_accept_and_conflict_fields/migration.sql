-- AlterTable
ALTER TABLE "Quote" ADD COLUMN "acceptedByName" TEXT;
ALTER TABLE "Quote" ADD COLUMN "conflictWarning" TEXT;
ALTER TABLE "Quote" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN "cancellationNote" TEXT;
