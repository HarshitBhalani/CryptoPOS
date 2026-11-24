-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'PENDING', 'CONFIRMED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BillStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "BillStatus" ADD VALUE 'REFUNDED';

-- DropIndex
DROP INDEX "PaymentQuote_billId_expiresAt_idx";

-- DropIndex
DROP INDEX IF EXISTS "LedgerJournal_verifiedTxId_type_key";

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "verifiedTxId" TEXT NOT NULL,
    "amountUnits" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "fiatAmount" DECIMAL(20,2),
    "fiatCurrency" TEXT DEFAULT 'USD',
    "destinationWallet" TEXT NOT NULL,
    "isDestinationOverridden" BOOLEAN NOT NULL DEFAULT false,
    "sourceWallet" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "idempotencyKey" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "signature" TEXT,
    "reference" TEXT,
    "slot" BIGINT,
    "blockTime" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "ledgerJournalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundAuditLog" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" "RefundStatus",
    "toStatus" "RefundStatus" NOT NULL,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefundAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_signature_key" ON "Refund"("signature");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_reference_key" ON "Refund"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_ledgerJournalId_key" ON "Refund"("ledgerJournalId");

-- CreateIndex
CREATE INDEX "Refund_merchantId_idx" ON "Refund"("merchantId");

-- CreateIndex
CREATE INDEX "Refund_billId_idx" ON "Refund"("billId");

-- CreateIndex
CREATE INDEX "Refund_verifiedTxId_idx" ON "Refund"("verifiedTxId");

-- CreateIndex
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- CreateIndex
CREATE INDEX "RefundAuditLog_refundId_idx" ON "RefundAuditLog"("refundId");

-- CreateIndex
CREATE INDEX "RefundAuditLog_actorId_idx" ON "RefundAuditLog"("actorId");

-- CreateIndex
CREATE INDEX "PaymentQuote_billId_createdAt_idx" ON "PaymentQuote"("billId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerJournal_verifiedTxId_type_idx" ON "LedgerJournal"("verifiedTxId", "type");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_verifiedTxId_fkey" FOREIGN KEY ("verifiedTxId") REFERENCES "VerifiedTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_ledgerJournalId_fkey" FOREIGN KEY ("ledgerJournalId") REFERENCES "LedgerJournal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundAuditLog" ADD CONSTRAINT "RefundAuditLog_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE CASCADE ON UPDATE CASCADE;
