-- Phase 7: Solana Devnet Payment Indexer & Verifier

-- Alter PaymentAttemptStatus enum
ALTER TYPE "PaymentAttemptStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "PaymentAttemptStatus" ADD VALUE 'REVIEW_REQUIRED';

-- Create VerificationStatus enum
CREATE TYPE "VerificationStatus" AS ENUM ('CONFIRMED', 'FAILED', 'PARTIAL', 'OVERPAID', 'LATE', 'INVALID');

-- Create VerifiedTransaction table
CREATE TABLE "VerifiedTransaction" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "attemptId" TEXT,
    "signature" TEXT NOT NULL,
    "slot" BIGINT NOT NULL,
    "blockTime" TIMESTAMP(3),
    "amountUnits" BIGINT NOT NULL,
    "feeUnits" BIGINT NOT NULL DEFAULT 0,
    "tokenMint" TEXT NOT NULL,
    "sourceOwner" TEXT NOT NULL,
    "destinationOwner" TEXT NOT NULL,
    "feeDestination" TEXT,
    "reference" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL,
    "reviewReason" TEXT,
    "metaRaw" JSONB,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerifiedTransaction_pkey" PRIMARY KEY ("id")
);

-- Create IndexerCheckpoint table
CREATE TABLE "IndexerCheckpoint" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "lastSlot" BIGINT NOT NULL DEFAULT 0,
    "lastSig" TEXT,
    "cursorMeta" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerCheckpoint_pkey" PRIMARY KEY ("id")
);

-- Unique indexes
CREATE UNIQUE INDEX "VerifiedTransaction_attemptId_key" ON "VerifiedTransaction"("attemptId");
CREATE UNIQUE INDEX "VerifiedTransaction_signature_key" ON "VerifiedTransaction"("signature");
CREATE UNIQUE INDEX "IndexerCheckpoint_key_key" ON "IndexerCheckpoint"("key");

-- Regular indexes
CREATE INDEX "VerifiedTransaction_billId_idx" ON "VerifiedTransaction"("billId");
CREATE INDEX "VerifiedTransaction_quoteId_idx" ON "VerifiedTransaction"("quoteId");
CREATE INDEX "VerifiedTransaction_status_idx" ON "VerifiedTransaction"("status");
CREATE INDEX "VerifiedTransaction_reference_idx" ON "VerifiedTransaction"("reference");

-- Foreign key constraints
ALTER TABLE "VerifiedTransaction" ADD CONSTRAINT "VerifiedTransaction_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerifiedTransaction" ADD CONSTRAINT "VerifiedTransaction_quoteId_fkey"
    FOREIGN KEY ("quoteId") REFERENCES "PaymentQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VerifiedTransaction" ADD CONSTRAINT "VerifiedTransaction_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
