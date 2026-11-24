ALTER TABLE "Bill"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT;

CREATE UNIQUE INDEX "Bill_merchantId_idempotencyKey_key"
  ON "Bill"("merchantId", "idempotencyKey");
