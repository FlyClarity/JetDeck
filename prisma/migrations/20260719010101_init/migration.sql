-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "clerkOrgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "wireInstructions" TEXT,
    "termsText" TEXT,
    "termsVersion" TEXT,
    "notifyEmail" TEXT,
    "depositPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "inboundEmail" TEXT,
    "operatorType" TEXT NOT NULL DEFAULT 'part135',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "type" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aircraft" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "tailNumber" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "homeBase" TEXT NOT NULL,
    "currentBase" TEXT,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "repoRate" DOUBLE PRECISION,
    "minHoursPerDay" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "hasWifi" BOOLEAN NOT NULL DEFAULT false,
    "rangeNm" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Aircraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripRequest" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "contactId" TEXT,
    "source" TEXT NOT NULL,
    "rawEmailBody" TEXT,
    "rawEmailFrom" TEXT,
    "requestorName" TEXT NOT NULL,
    "requestorEmail" TEXT NOT NULL,
    "requestorPhone" TEXT,
    "requestorCompany" TEXT,
    "requestorType" TEXT NOT NULL,
    "tripType" TEXT NOT NULL,
    "legs" JSONB NOT NULL,
    "aircraftPref" TEXT,
    "budgetMentioned" DOUBLE PRECISION,
    "specialRequests" TEXT,
    "urgency" TEXT,
    "opportunityScore" TEXT,
    "scoreReason" TEXT,
    "positioningNote" TEXT,
    "historyNote" TEXT,
    "recommendedAction" TEXT,
    "aiProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "tripRequestId" TEXT,
    "contactId" TEXT,
    "aircraftId" TEXT,
    "fleetSource" TEXT NOT NULL DEFAULT 'own_fleet',
    "brokeredAircraftId" TEXT,
    "itinerary" JSONB NOT NULL,
    "flightHours" DOUBLE PRECISION NOT NULL,
    "hourlyRate" DOUBLE PRECISION NOT NULL,
    "repoHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repoRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
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
    "internalNotes" TEXT,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedIp" TEXT,
    "acceptedUserAgent" TEXT,
    "acceptedTermsHash" TEXT,
    "declinedAt" TIMESTAMP(3),
    "stripePaymentIntentId" TEXT,
    "cardHoldStatus" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "tripNumber" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreferredOperator" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreferredOperator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrokeredAircraft" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "preferredOperatorId" TEXT NOT NULL,
    "tailNumber" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "category" TEXT,
    "seats" INTEGER,
    "homeBase" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokeredAircraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundEmail" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "fromName" TEXT,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "classification" TEXT NOT NULL,
    "classificationConfidence" TEXT,
    "classificationReason" TEXT,
    "aiProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'processing',
    "tripRequestId" TEXT,
    "quoteId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "correctedAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Operator_clerkOrgId_key" ON "Operator"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_slug_key" ON "Operator"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_token_key" ON "Quote"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_quoteId_key" ON "Trip"("quoteId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aircraft" ADD CONSTRAINT "Aircraft_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripRequest" ADD CONSTRAINT "TripRequest_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripRequest" ADD CONSTRAINT "TripRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_tripRequestId_fkey" FOREIGN KEY ("tripRequestId") REFERENCES "TripRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_aircraftId_fkey" FOREIGN KEY ("aircraftId") REFERENCES "Aircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_brokeredAircraftId_fkey" FOREIGN KEY ("brokeredAircraftId") REFERENCES "BrokeredAircraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreferredOperator" ADD CONSTRAINT "PreferredOperator_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrokeredAircraft" ADD CONSTRAINT "BrokeredAircraft_preferredOperatorId_fkey" FOREIGN KEY ("preferredOperatorId") REFERENCES "PreferredOperator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundEmail" ADD CONSTRAINT "InboundEmail_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

