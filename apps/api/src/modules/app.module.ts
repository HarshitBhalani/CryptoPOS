import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { z } from "zod";
import { HealthController } from "./health.controller";
import { InfrastructureModule } from "./infrastructure.module";
import { AuthModule } from "./auth/auth.module";
import { MerchantsModule } from "./merchants/merchants.module";
import { BillsModule } from "./bills/bills.module";
import { PaymentsModule } from "./payments/payments.module";
import { IndexerModule } from "./indexer/indexer.module";
import { LedgerModule } from "./ledger/ledger.module";
import { RefundsModule } from "./refunds/refunds.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { AdminModule } from "./admin/admin.module";
import { DEVNET_USDC_MINT } from "../blockchain/solana.constants";
import { isValidSolanaAddress } from "../blockchain/solana.validator";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  BACKEND_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url(),
  SOLANA_NETWORK: z.literal("devnet"),
  SOLANA_RPC_URL: z.string().url(),
  SOLANA_EXPLORER_URL: z.string().url(),
  SOLANA_USDC_MINT: z.string().refine((mint) => mint === DEVNET_USDC_MINT, {
    message: `SOLANA_USDC_MINT must match the verified Devnet USDC mint (${DEVNET_USDC_MINT})`,
  }),
  PLATFORM_FEE_WALLET: z.string().refine((wallet) => !wallet || isValidSolanaAddress(wallet), {
    message: "PLATFORM_FEE_WALLET must be empty or a valid 32-byte Solana public key in base58 format",
  }).default(""),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(0),
  QUOTE_TTL_SECONDS: z.coerce.number().int().positive().default(120),
  PAYMENT_LATE_GRACE_SECONDS: z.coerce.number().int().nonnegative().default(30),
  PRICE_PROVIDER_API_KEY: z.string().default(""),
  PRICE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().max(60).default(15),
  PRICE_MAX_AGE_SECONDS: z.coerce.number().int().positive().max(300).default(120),
  PAYMENT_CONFIRMATION_LEVEL: z.enum(["confirmed", "finalized"]).default("finalized"),
});

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../../.env", ".env"], validate: (config) => envSchema.parse(config) }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
    InfrastructureModule,
    AuthModule,
    MerchantsModule,
    BillsModule,
    PaymentsModule,
    IndexerModule,
    LedgerModule,
    RefundsModule,
    AnalyticsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
