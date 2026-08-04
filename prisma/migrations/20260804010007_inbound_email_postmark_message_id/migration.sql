-- AlterTable
ALTER TABLE "InboundEmail" ADD COLUMN "postmarkMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "InboundEmail_postmarkMessageId_key" ON "InboundEmail"("postmarkMessageId");
