DO $$ BEGIN
  CREATE TYPE "QuoteStatus" AS ENUM ('ACTIVE', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PaymentQuote"
  ADD COLUMN IF NOT EXISTS "merchantId" TEXT,
  ADD COLUMN IF NOT EXISTS "tokenSymbol" TEXT NOT NULL DEFAULT 'USDC',
  ADD COLUMN IF NOT EXISTS "tokenDecimals" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS "fiatCurrency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS "totalUnits" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "feeBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "priceSource" TEXT NOT NULL DEFAULT 'coingecko',
  ADD COLUMN IF NOT EXISTS "priceUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "status" "QuoteStatus" NOT NULL DEFAULT 'ACTIVE';

UPDATE "PaymentQuote" AS q
SET "merchantId" = b."merchantId",
    "fiatCurrency" = b."currency",
    "totalUnits" = q."cryptoUnits" + q."feeUnits",
    "priceUpdatedAt" = q."createdAt"
FROM "Bill" AS b
WHERE b."id" = q."billId";

ALTER TABLE "PaymentQuote"
  ALTER COLUMN "merchantId" SET NOT NULL,
  ALTER COLUMN "priceUpdatedAt" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "PaymentQuote" ADD CONSTRAINT "PaymentQuote_merchantId_fkey"
    FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "PaymentQuote_merchantId_createdAt_idx" ON "PaymentQuote"("merchantId", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentQuote_status_expiresAt_idx" ON "PaymentQuote"("status", "expiresAt");
