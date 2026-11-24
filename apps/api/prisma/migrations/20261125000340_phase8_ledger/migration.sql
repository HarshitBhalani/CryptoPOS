-- Phase 8: Append-only double-entry accounting ledger

-- Create Enums
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "LedgerEntryDirection" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "JournalType" AS ENUM ('PAYMENT_SETTLEMENT', 'REVERSAL', 'ADJUSTMENT');

-- Create LedgerAccount table
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "network" TEXT DEFAULT 'devnet',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- Create LedgerJournal table
CREATE TABLE "LedgerJournal" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT,
    "billId" TEXT,
    "verifiedTxId" TEXT,
    "type" "JournalType" NOT NULL DEFAULT 'PAYMENT_SETTLEMENT',
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "network" TEXT DEFAULT 'devnet',
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "totalDebitUnits" BIGINT NOT NULL,
    "totalCreditUnits" BIGINT NOT NULL,
    "fiatAmount" DECIMAL(20,2),
    "fiatCurrency" TEXT,
    "originalJournalId" TEXT,
    "reversalReason" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerJournal_pkey" PRIMARY KEY ("id")
);

-- Create LedgerEntry table
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "direction" "LedgerEntryDirection" NOT NULL,
    "amountUnits" BIGINT NOT NULL,
    "amountDecimal" DECIMAL(30,12),
    "entryOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- Unique constraints & indexes
CREATE UNIQUE INDEX "LedgerAccount_merchantId_code_currency_key" ON "LedgerAccount"("merchantId", "code", "currency");
CREATE INDEX "LedgerAccount_merchantId_type_idx" ON "LedgerAccount"("merchantId", "type");

CREATE UNIQUE INDEX "LedgerJournal_idempotencyKey_key" ON "LedgerJournal"("idempotencyKey");
CREATE UNIQUE INDEX "LedgerJournal_verifiedTxId_type_key" ON "LedgerJournal"("verifiedTxId", "type");
CREATE INDEX "LedgerJournal_merchantId_postedAt_idx" ON "LedgerJournal"("merchantId", "postedAt");
CREATE INDEX "LedgerJournal_billId_idx" ON "LedgerJournal"("billId");
CREATE INDEX "LedgerJournal_type_idx" ON "LedgerJournal"("type");

CREATE INDEX "LedgerEntry_journalId_idx" ON "LedgerEntry"("journalId");
CREATE INDEX "LedgerEntry_accountId_idx" ON "LedgerEntry"("accountId");

-- Foreign key constraints
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerJournal" ADD CONSTRAINT "LedgerJournal_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerJournal" ADD CONSTRAINT "LedgerJournal_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerJournal" ADD CONSTRAINT "LedgerJournal_verifiedTxId_fkey"
    FOREIGN KEY ("verifiedTxId") REFERENCES "VerifiedTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerJournal" ADD CONSTRAINT "LedgerJournal_originalJournalId_fkey"
    FOREIGN KEY ("originalJournalId") REFERENCES "LedgerJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_journalId_fkey"
    FOREIGN KEY ("journalId") REFERENCES "LedgerJournal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
