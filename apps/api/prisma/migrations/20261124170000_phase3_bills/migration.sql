-- Add the bill fields needed for backend-calculated totals and shareable bill links.
CREATE TYPE "BillStatus" AS ENUM (
  'DRAFT',
  'OPEN',
  'PENDING',
  'PAID',
  'EXPIRED',
  'CANCELLED',
  'PARTIALLY_PAID',
  'OVERPAID',
  'PAYMENT_REVIEW'
);

ALTER TABLE "Bill"
  ADD COLUMN "publicToken" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "customerName" TEXT,
  ADD COLUMN "customerEmail" TEXT,
  ADD COLUMN "subtotal" DECIMAL(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN "taxAmount" DECIMAL(20,2) NOT NULL DEFAULT 0;

-- Preserve existing bill records if present; legacy totals are retained as subtotal with zero tax.
UPDATE "Bill"
SET "publicToken" = replace(gen_random_uuid()::text, '-', ''),
    "subtotal" = round("total", 2);

ALTER TABLE "Bill"
  ALTER COLUMN "publicToken" SET NOT NULL,
  ALTER COLUMN "total" TYPE DECIMAL(20,2) USING round("total", 2),
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "BillStatus" USING (
    CASE upper("status")
      WHEN 'DRAFT' THEN 'DRAFT'
      WHEN 'OPEN' THEN 'OPEN'
      WHEN 'PENDING' THEN 'PENDING'
      WHEN 'PAID' THEN 'PAID'
      WHEN 'EXPIRED' THEN 'EXPIRED'
      WHEN 'CANCELLED' THEN 'CANCELLED'
      WHEN 'PARTIALLY_PAID' THEN 'PARTIALLY_PAID'
      WHEN 'OVERPAID' THEN 'OVERPAID'
      WHEN 'PAYMENT_REVIEW' THEN 'PAYMENT_REVIEW'
      ELSE 'DRAFT'
    END
  )::"BillStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "BillItem"
  ADD COLUMN "lineTotal" DECIMAL(20,2);

UPDATE "BillItem"
SET "lineTotal" = round("quantity" * "unitPrice", 2);

ALTER TABLE "BillItem"
  ALTER COLUMN "lineTotal" SET NOT NULL;

CREATE UNIQUE INDEX "Bill_publicToken_key" ON "Bill"("publicToken");
