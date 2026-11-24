-- Phase 6: Payment submission
-- Add recipient snapshot fields and Solana Pay reference to PaymentQuote
ALTER TABLE "PaymentQuote" ADD COLUMN "merchantRecipient" TEXT;
ALTER TABLE "PaymentQuote" ADD COLUMN "feeRecipient" TEXT;
ALTER TABLE "PaymentQuote" ADD COLUMN "reference" TEXT;
CREATE UNIQUE INDEX "PaymentQuote_reference_key" ON "PaymentQuote"("reference");

-- PaymentAttemptStatus enum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('PENDING', 'FAILED');

-- PaymentAttempt model
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "customerWallet" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "signature" TEXT,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentAttempt_quoteId_key" ON "PaymentAttempt"("quoteId");
CREATE UNIQUE INDEX "PaymentAttempt_reference_key" ON "PaymentAttempt"("reference");
CREATE UNIQUE INDEX "PaymentAttempt_signature_key" ON "PaymentAttempt"("signature");
CREATE INDEX "PaymentAttempt_billId_idx" ON "PaymentAttempt"("billId");
CREATE INDEX "PaymentAttempt_merchantId_idx" ON "PaymentAttempt"("merchantId");

ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "PaymentQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_billId_fkey"
  FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
