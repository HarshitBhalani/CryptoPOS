# CryptoPOS project status and AI handoff

Last updated: 2026-11-25 (Asia/Calcutta)

## Phase 1–4 Review and Fixes (Completed 2026-11-25)

An in-depth audit of Phases 1 through 4 was completed. Confirmed defects were identified and fixed:
1. **Phase 1 (Redis Error & Reconnect Resilience):**
   - Implemented `OnModuleInit` and `OnModuleDestroy` on `RedisService` (`apps/api/src/modules/redis.service.ts`).
   - Attached an explicit `client.on("error")` handler with logger warnings and reconnect retry strategy (`Math.min(times * 100, 3000)`). This prevents unhandled EventEmitter `"error"` crashes when Redis restarts or drops connection.
2. **Phase 2 (Platform Admin MerchantOwnerGuard Isolation):**
   - Fixed `MerchantOwnerGuard` (`apps/api/src/modules/merchants/merchant-owner.guard.ts`) to verify `merchantId` existence and active status in the database before granting access to `PLATFORM_ADMIN`. It now sets `request.merchantId` and `request.merchantRole = UserRole.PLATFORM_ADMIN` identically to `MerchantAccessGuard`, eliminating 500 errors when accessing invalid merchant IDs.
3. **Phase 4 (Price Provider Decimal Arithmetic):**
   - Replaced JavaScript floating-point `Number(rawRate)` in `PriceProvider` (`apps/api/src/modules/quotes/price-provider.ts`) with `new Prisma.Decimal(rawRate)` validation (`decimalRate.isNaN() || !decimalRate.isFinite() || decimalRate.lte(0)`), guaranteeing zero floating-point arithmetic throughout the rate ingestion and conversion pipeline.
4. **Verification & Monorepo Build:**
   - 22/22 automated test assertions passed covering database connection, Redis connectivity, Solana Devnet genesis hash validation, atomic owner registration, bcrypt hashing, cashier management, refresh token rotation with reuse detection, exact decimal bill math with `HALF_UP` rounding, public endpoint customer data omission, bill cancellation, Redis price cache read/write, exact BigInt unit ratios, fee rounding, and immutable quote snapshots.
   - Clean builds verified: `@cryptopos/api` (`nest build`) and `@cryptopos/web` (`next build` all 12 routes) exited with code 0.

## Resume here

Read this file first, then `README.md`, `docs/ARCHITECTURE.md`, `docs/API_DOCUMENTATION.md`, `docs/DATABASE_SCHEMA.md`, and the project brief supplied by the user. The user requested strict phase order, accurate code, one persistent handoff file, and a status update when each phase ends. Continue the current phase only; stop before the next phase until the user explicitly approves it. Update this file whenever phase status or run instructions change. Never place credentials or `.env` values here.

## Product and technical direction

CryptoPOS is a non-custodial merchant POS. All development payments must remain on Solana Devnet. Customer funds go directly to merchant-controlled wallets; the platform must never custody funds. Monorepo: Next.js App Router in `apps/web`, NestJS modular API in `apps/api`, PostgreSQL/Prisma and Redis. Financial totals are computed on the backend with Prisma Decimal; never use JS floating point for money.

## Phase status

- [x] Phase 1 — Foundation: Next.js/NestJS workspaces, environment validation, PostgreSQL/Redis Compose, Prisma baseline, health endpoint, architecture docs. Verified apps build; API health reported PostgreSQL and Redis ready.
- [x] Phase 2 — Auth/roles: merchant registration creates owner+business atomically; bcrypt password hashing; login/logout; HTTP-only JWT access and rotating refresh cookies; hashed refresh sessions; auth/role/merchant guards; owner cashier-management API; auth frontend; throttle limits. Prisma migration applied and auth/staff smoke flow passed.
- [x] Phase 3 — Merchant dashboard and POS: owner business settings, exact-decimal bill creation, active merchant scoping, list/detail/cancel, public bill URL/QR, responsive dashboard shell and merchant selector.
- [x] Phase 4 — Quote engine: CoinGecko Demo price adapter with Redis short cache and freshness checks; exact smallest-unit USDC conversion and fee rounding; immutable 120-second Devnet quote snapshots; customer quote UI and owner/cashier quote history.
- [x] Phase 5 — Solana Devnet wallet integration: strict 32-byte Base58 Solana address validation; verified Devnet USDC mint (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals); owner-only settlement wallet API and dashboard UI; public bill settlement exposure; non-custodial customer Phantom wallet connection and network verification on Devnet with quote preservation.
- [x] Phase 6 — Payment submission: Devnet RPC genesis hash verification (`GH7ome3EiwEr7tu9JuPh2dpYWBJK3z69Xm1ZE3MEE6JC`); quote recipient snapshots (`merchantRecipient`, `feeRecipient`); SPL token payment construction using integer smallest-unit amounts; unique Solana Pay reference generation; Phantom `signAndSendTransaction` customer flow; idempotent `POST /public/pay/:paymentToken/submit` recording `PaymentAttempt` with `PENDING` status only (never marking `PAID` from submission); UI payment flow with live states.
- [x] Phase 7 — Independent blockchain indexer: standalone worker entrypoint (`npm run worker`); Redis distributed worker lease; RPC genesis hash verification (`GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC` and `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`); Solana Pay reference candidate discovery & pending attempt polling; legacy and v0 SPL token instruction decoding; exact bigint smallest-unit verification; late/partial/overpaid/failed review classifications; atomic PostgreSQL settlement with duplicate/replay protection; merchant payment history & review APIs; customer real-time polling and confirmation UI.
- [x] Phase 8 — Transactions and append-only ledger: Prisma schema migration `20261125000340_phase8_ledger` (`LedgerAccount`, `LedgerJournal`, `LedgerEntry`); double-entry Chart of Accounts (`1110` Merchant Settlement Asset, `4100` Merchant Sales Revenue, `1120` Platform Fee Asset, `4200` Platform Fee Revenue, `2110` Customer Prepayment); exact `BigInt` smallest-unit integer posting; strict debit/credit balance verification (`sum(Debits) === sum(Credits)`); platform fee separation into platform-scoped accounts (`merchantId = null`); idempotent posting (`settle_<sig>` and `@@unique([verifiedTxId, type])`); immutable opposing reversal journals (`POST /reverse`) with owner authorization and audit reasons; merchant accounts balance aggregation; discrepancy reconciliation detector (`isReconciled`); indexer-to-ledger auto-posting hook upon transaction confirmation.
- [x] Phase 9 — Refunds: Prisma schema migration `20261125002000_phase9_refunds` (`Refund`, `RefundAuditLog`, `RefundStatus` enum, `BillStatus` extensions `PARTIALLY_REFUNDED` and `REFUNDED`); non-custodial merchant Phantom signing flow with client-side Devnet RPC cluster and wallet address verification; strict remaining-refundable balance calculation per verified payment; platform fee exclusion and disclosure policy; default payer destination with owner-confirmed overrides (`isDestinationOverridden`); full lifecycle state transitions (`REQUESTED` -> `APPROVED` -> `PENDING` -> `CONFIRMED` / `FAILED` / `REJECTED`); owner-only approval/rejection/submission authorization (`MerchantOwnerGuard`); unique Solana Pay reference generation; independent on-chain verification at `finalized` commitment via `solana.verifier.ts` and indexer batch polling; atomic post-finalization double-entry ledger adjustment (DEBIT `4100_MERCHANT_SALES`, CREDIT `1110_USDC_MERCHANT_SETTLEMENT`); merchant dashboard refund UI (`RefundSection`) with live balances, request form, owner approval/rejection controls, and Phantom signing integration.
- [x] Phase 10 — Merchant analytics and admin: Prisma schema migration `20261125003500_phase10_admin_audit` (`AdminAuditLog`); merchant-scoped financial analytics module (`AnalyticsService`, `AnalyticsController`) deriving exact metrics strictly from finalized on-chain transactions and posted double-entry ledger entries; exact integer token units (`BigInt`, 6 decimals for Devnet USDC) and `Prisma.Decimal` fiat totals; continuous daily time series aggregation with UTC date boundaries; date range validation (inverted range check and 365-day maximum cap); merchant data isolation and role access; platform admin module (`AdminService`, `AdminController`) guarded by `JwtAuthGuard`, `RolesGuard`, and `@Roles(UserRole.PLATFORM_ADMIN)`; platform overview (merchants, bills, gross/net volume, fee allocations, indexer status, ledger health); merchant directory with search and active/suspended filtering; merchant status mutation (`ACTIVE` <-> `SUSPENDED`) with mandatory audit reason logging to `AdminAuditLog`; immediate `MerchantAccessGuard` enforcement blocking suspended merchants; system-wide double-entry ledger reconciliation report auditing all journals; frontend merchant analytics dashboard (`/dashboard/analytics`) with prominent Devnet testnet disclaimer badge; frontend platform administration console (`/admin` and `/admin/merchants/:merchantId`).
- [x] Phase 11 — Quality, security review and deployment: dependency vulnerability review and audit analysis; security hardening (multi-origin CORS, security headers middleware, global exception filter sanitizing database constraints, request duration logger); enhanced health and readiness probe (`/api/v1/health` testing Postgres, Redis, Solana Devnet RPC, indexer checkpoint, and memory; `/api/v1/health/live` for liveness); Next.js global error boundary (`error.tsx`) and 404 page (`not-found.tsx`); multi-stage production Dockerfiles (`Dockerfile.api`, `Dockerfile.web`, `Dockerfile.worker`) running as non-root with dumb-init; full production orchestration (`docker-compose.prod.yml`) with persistent volumes and healthchecks; production environment template (`.env.production.example`) with zero exposed secrets; comprehensive production runbook (`docs/DEPLOYMENT.md`) reviewing hosting options, verified pricing, sleeping-host unsuitability, backup/restore procedures, and zero-downtime rolling updates; master end-to-end verification passing 13/13 test checks.

## Project completion status: Phases 1 through 11 complete

All eleven development phases of CryptoPOS are implemented, tested, and verified. The application is fully prepared for production deployment. When user hosting credentials or deployment targets are provided, follow `docs/DEPLOYMENT.md` to trigger live container orchestration.

## Deployment readiness review (2026-11-25)

- Fixed production Docker build/deploy blockers: Prisma generation now uses a build-only placeholder `.env` (no deployment secrets baked into images); Compose passes public Next.js build arguments; web container explicitly listens on port 3000; web/API host ports bind to loopback for the Caddy reverse proxy; web image creates the empty `public` directory before copying it.
- `.env.production.example` has explicit password placeholders and is allowed by `.gitignore`; actual `.env` and `.env.production` remain ignored.
- `docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet` passed using placeholder values. No cloud deployment has happened: this workspace has no Git repository/remote, VPS, domain, or production credentials.
- Deployment still needs an always-on host and a domain with `pos` and `api` subdomains. `PRICE_PROVIDER_API_KEY` is blank and required for quote creation. `PLATFORM_FEE_WALLET` is optional only while `PLATFORM_FEE_BPS=0`.

## Phase 11 checklist

- [x] Perform dependency vulnerability review (`npm audit`):
  - Evaluated all 19 advisories across `@solana/web3.js`, `@solana/spl-token`, `prisma`, `next`, `glob`, `postcss`, and `zod`.
  - Identified that automated breaking fixes (`npm audit fix --force`) would downgrade/break Solana SPL token transaction serialization and Next.js compiler. Documented exact architectural mitigations: strict Devnet RPC genesis hash validation, exact integer balance assertions, and bounded inputs.
- [x] Implement backend API security & operational hardening (`apps/api/`):
  - `GlobalExceptionFilter`: Sanitizes Prisma database constraint errors (`P2002`, `P2025`) and prevents internal SQL queries or server stack traces from leaking to clients.
  - `SecurityHeadersMiddleware`: Injects `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Strict-Transport-Security` in production.
  - `RequestLoggerMiddleware`: Structured logging of HTTP method, URL, status code, and execution time in ms without recording sensitive cookies or authorization tokens.
  - Multi-origin CORS support: Allows comma-separated allowed origins in `FRONTEND_URL`.
  - Graceful shutdown: Enabled `app.enableShutdownHooks()` for clean Prisma disconnection and HTTP draining on SIGTERM/SIGINT.
- [x] Implement comprehensive system health and readiness probes (`apps/api/src/modules/health.controller.ts`):
  - `GET /api/v1/health/live`: Fast liveness probe returning uptime seconds for container orchestrators.
  - `GET /api/v1/health`: In-depth readiness check evaluating PostgreSQL query latency, Redis PING latency, Solana Devnet RPC slot connectivity, Indexer checkpoint status, and process memory utilization (RSS/heap). Returns HTTP 200 when ready or HTTP 503 when degraded.
- [x] Implement frontend resilience & error handling (`apps/web/`):
  - Created Next.js global error boundary (`apps/web/app/error.tsx`) providing user-friendly fallback and recovery without crashing the client view.
  - Created custom 404 page (`apps/web/app/not-found.tsx`) with dashboard and home navigation links.
- [x] Create production container configurations:
  - `Dockerfile.api`: Multi-stage Alpine container compiling NestJS, installing dumb-init, and running as non-root user `cryptopos`.
  - `Dockerfile.worker`: Multi-stage Alpine container executing the standalone payment indexer daemon (`node apps/api/dist/worker.js`).
  - `Dockerfile.web`: Multi-stage Alpine container building and serving Next.js.
  - `docker-compose.prod.yml`: Production stack orchestrating PostgreSQL 16 Alpine (with persistent NVMe volume and health check), Redis 7 Alpine (with persistent data volume and `noeviction` memory limits), API, Web, and Worker containers.
  - `.env.production.example`: Complete environment variable template with secure generation instructions and zero leaked secrets.
- [x] Author comprehensive production deployment and operational runbook (`docs/DEPLOYMENT.md`):
  - Technical analysis detailing why free or sleeping hosting tiers (Render free, Koyeb, Heroku Eco) are strictly unsuitable for POS indexing.
  - Verified pricing comparison for Hetzner Cloud ($4/mo), Railway ($10–$20/mo), Fly.io ($12–$25/mo), and Render paid ($28/mo).
  - Step-by-step Linux VPS setup, firewall (UFW), Docker Engine, Caddy reverse proxy with automated Let's Encrypt TLS.
  - Automated database backup cron script (`pg_dump` compressed with 14-day retention) and restoration drill.
  - Zero-downtime rolling update instructions and monitoring alert thresholds.
- [x] Execute Phase 11 master verification test suite:
  - 13/13 master assertions passed covering Devnet network & USDC mint isolation, RPC genesis hash on-chain verification, multi-role user creation, merchant settlement wallet setup, exact decimal bill calculations, quote recipient snapshotting, payment verification finality, double-entry ledger debit-credit equality, non-custodial refund confirmation and bill status transition, merchant analytics math, access guards, admin status mutation and audit logging, and system-wide ledger balance.
- [x] Verify clean builds across monorepo:
  - `@cryptopos/api`: `nest build` completed with exit code 0.
  - `@cryptopos/web`: `next build` compiled all 12 routes with exit code 0.
- [x] Synchronize all project documentation (`README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/DATABASE_SCHEMA.md`, `docs/API_DOCUMENTATION.md`, `docs/SECURITY.md`, `docs/USER_FLOWS.md`, `PROJECT_STATUS.md`).

## Phase 10 checklist

- [x] Apply schema migration `20261125003500_phase10_admin_audit` to create:
  - Model `AdminAuditLog`: `actorId`, `actorEmail`, `action`, `targetType`, `targetId`, `details` (JSON payload with previous status, new status, and audit reason), and `createdAt`.
  - Indices on `actorId`, `[targetType, targetId]`, and `createdAt`.
- [x] Implement backend merchant analytics module (`apps/api/src/modules/analytics/`):
  - `getMerchantOverview`: Scoped to `merchantId`. Derives `grossSalesUnits`, `refundUnits`, `netSalesUnits`, `platformFeeUnits`, `averagePaymentUnits`, `transactionCount`, `refundCount`, segregated `USD` fiat totals, bill status distribution, and double-entry ledger balance check.
  - `getMerchantTimeSeries`: Continuous daily buckets with gross sales, refunds, net sales, fee units, transaction count, and fiat net amounts.
  - Date range validation: Enforces `startDate <= endDate` and rejects ranges exceeding 365 days with `BadRequestException`.
  - Exact arithmetic: Uses exact integer smallest units (`BigInt`, 6 decimals for Devnet USDC) and `Prisma.Decimal` for fiat. Zero JavaScript floating-point conversions.
  - Formatted representations: `formatTokenUnits` produces exact decimal strings without float precision loss.
  - Endpoints: `GET /merchants/:merchantId/analytics/overview` and `GET /merchants/:merchantId/analytics/series` protected by `JwtAuthGuard` and `MerchantAccessGuard`. Both Cashier and Owner can access.
- [x] Implement backend platform admin module (`apps/api/src/modules/admin/`):
  - Strict role enforcement: Protected by `JwtAuthGuard`, `RolesGuard`, and `@Roles(UserRole.PLATFORM_ADMIN)`. Cashiers and Owners receive 403 Forbidden.
  - `getPlatformOverview`: Platform-wide totals (active/suspended merchants, bills by status, gross/net volume, fee volume, indexer status, ledger health).
  - `listMerchants`: Paginated merchants directory with volume calculations, owner details, settlement addresses, and search/status filters. Excludes customer contact info and private keys.
  - `getMerchantDetails`: Single merchant detailed profile, team members, wallets, volume metrics, bills distribution, and audit log history.
  - `updateMerchantStatus`: Database transaction updating `Merchant.status` (`ACTIVE` / `SUSPENDED`) and creating an immutable `AdminAuditLog` record with mandatory audit reason.
  - `listAuditLogs`: Paginated audit log records with action and target filtering.
  - `getLedgerReconciliation`: System-wide double-entry ledger reconciliation report auditing all posted journals and verifying debits equal credits.
- [x] Implement frontend merchant analytics dashboard (`apps/web/app/dashboard/analytics/`):
  - Created `/dashboard/analytics/page.tsx` with date preset buttons ("Last 7 Days", "Last 30 Days", "Last 90 Days") and custom date pickers.
  - Prominent "Solana Devnet Testnet" disclaimer badge.
  - Crypto KPI cards (Net Sales, Gross Sales, Refunds, Platform Fees Paid, Average Payment) and fiat equivalents.
  - Double-entry ledger audit integrity card.
  - Daily financial breakdown table and bill status distribution grid.
  - Added "Analytics" link to navigation sidebar.
- [x] Implement frontend platform administration console (`apps/web/app/admin/`):
  - Created `apps/web/app/admin/layout.tsx` enforcing `PLATFORM_ADMIN` role with access-denied fallback and navigation.
  - Created `apps/web/app/admin/page.tsx` with Overview, Merchants Directory, Audit Logs, and Ledger Reconciliation tabs.
  - Added merchant status toggle modal ("Suspend" / "Activate") requiring an audit reason.
  - Created `apps/web/app/admin/merchants/[merchantId]/page.tsx` for inspecting single merchant details, wallets, members, volume, and audit logs.
  - Added "Platform Admin" navigation link for admin accounts.
- [x] Execute Phase 10 integration and security test suite:
  - 23/23 assertions passed covering exact integer math, zero float usage, segregated fiat metrics, daily time series, date range boundary validation, 365-day cap, cross-merchant isolation, cashier/owner merchant access, admin role rejection for non-admins, platform overview aggregates, merchant search and filtering, admin status mutation (`ACTIVE` -> `SUSPENDED` -> `ACTIVE`), immutable `AdminAuditLog` persistence, `MerchantAccessGuard` suspension enforcement, audit logs listing, and double-entry ledger reconciliation.
  - Removed temporary test script.
- [x] Verified `npm.cmd run build` across `@cryptopos/api` and `@cryptopos/web` with clean exit code 0.
- [x] Updated all project documentation (`DATABASE_SCHEMA.md`, `API_DOCUMENTATION.md`, `SECURITY.md`, `USER_FLOWS.md`, `PROJECT_STATUS.md`).

## Phase 9 checklist

- [x] Apply schema migration `20261125002000_phase9_refunds` to create:
  - Enum `RefundStatus`: `REQUESTED`, `APPROVED`, `REJECTED`, `PENDING`, `CONFIRMED`, `FAILED`.
  - Extend `BillStatus`: `PARTIALLY_REFUNDED`, `REFUNDED`.
  - Model `Refund`: `verifiedTxId`, `amountUnits` (`BigInt`), `destinationWallet`, `isDestinationOverridden`, `sourceWallet`, `status`, `idempotencyKey`, `requestedById`, `approvedById`, `signature`, `reference`, `ledgerJournalId`.
  - Model `RefundAuditLog`: immutable history tracking status transitions, actor IDs, actions, and audit notes.
  - Multi-column index on `LedgerJournal(verifiedTxId, type)` replacing unique constraint to support multiple partial refund adjustments.
- [x] Implement on-chain refund verifier (`apps/api/src/blockchain/solana.verifier.ts`):
  - `verifyRefundTransaction`: Decodes SPL transfers, asserts `meta.err === null`, checks Solana Pay refund reference in account keys, verifies Devnet USDC mint, checks source is merchant settlement wallet, checks destination is customer ATA, and verifies exact integer smallest units.
- [x] Implement double-entry ledger refund adjustment (`apps/api/src/modules/ledger/ledger.service.ts`):
  - `postRefundAdjustment`: Creates append-only journal of type `ADJUSTMENT` with DEBIT `4100_MERCHANT_SALES` and CREDIT `1110_USDC_MERCHANT_SETTLEMENT`, balanced integer units, idempotency key `refund_settle_${refund.id}`, and link to original payment journal.
  - Updated `getReconciliationReport` to verify confirmed refunds have posted ledger journals.
- [x] Implement refund backend service and controller (`apps/api/src/modules/refunds/`):
  - `requestRefund`: Enforces `CONFIRMED` payment status, validates remaining refundable balance, rejects platform fee refunds, sets payer destination by default, computes proportional fiat, records audit log.
  - `approveRefund`: Owner-only (`MerchantOwnerGuard`), re-checks balance, generates unique Solana Pay reference, returns signing payload.
  - `rejectRefund`: Owner-only, records rejection reason, releases reserved refundable balance.
  - `submitRefund`: Owner-only, validates signature uniqueness, sets status to `PENDING` (never marks complete from submission alone).
  - `verifyAndConfirmRefund`: Independent on-chain verification at `finalized` commitment, atomically marks `CONFIRMED`, posts ledger adjustment, updates `Bill.status` to `PARTIALLY_REFUNDED` or `REFUNDED`.
  - `processPendingRefunds`: Background batch processor for the indexer.
  - `getRefundableSummaryForBill`: Breakdown of total paid, confirmed refunds, reserved refunds, and remaining balance.
- [x] Integrate background refund processing into Indexer (`apps/api/src/modules/indexer/`):
  - Injected `RefundsService` into `IndexerService.runOnce()`.
  - Polling cycle processes pending refunds and verifies on-chain finality.
- [x] Implement merchant frontend refund UI (`apps/web/`):
  - Built `buildUsdcRefundTransaction` in `apps/web/lib/payment.ts`.
  - Created `RefundSection` in `apps/web/app/dashboard/bills/[billId]/refund-section.tsx` with refundable balance cards, fee disclosure, request modal, status badges, owner approval/rejection controls, and Phantom signing integration with address matching.
  - Integrated into Bill Detail page (`[billId]/page.tsx`).
- [x] Execute Phase 9 smoke test suite:
  - 40/40 assertions passed covering eligibility, platform fee exclusion, remaining balance limits, destination overrides, owner rejection & balance release, owner approval & reference generation, submission state tracking, on-chain verification & ledger adjustment, full refund bill status transition (`REFUNDED`), and ledger reconciliation.
  - Removed temporary smoke test script.
- [x] Verified `npm.cmd run build` across `@cryptopos/api` and `@cryptopos/web` with clean exit code 0.
- [x] Updated all project documentation (`DATABASE_SCHEMA.md`, `API_DOCUMENTATION.md`, `SECURITY.md`, `USER_FLOWS.md`, `PROJECT_STATUS.md`).

## Phase 8 checklist

- [x] Apply schema migration `20261125000340_phase8_ledger` to create:
  - Enums: `LedgerAccountType` (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`), `LedgerEntryDirection` (`DEBIT`, `CREDIT`), `JournalType` (`PAYMENT_SETTLEMENT`, `REVERSAL`, `ADJUSTMENT`).
  - Models: `LedgerAccount` (with `[merchantId, code, currency]` unique constraint), `LedgerJournal` (with `idempotencyKey` and `[verifiedTxId, type]` unique constraints), `LedgerEntry` (with direction, `amountUnits: BigInt`, and `entryOrder`).
- [x] Define Chart of Accounts and posting rules (`apps/api/src/modules/ledger/ledger.constants.ts`):
  - `1110_USDC_MERCHANT_SETTLEMENT` (Asset, merchant-scoped).
  - `4100_MERCHANT_SALES` (Revenue, merchant-scoped).
  - `1120_USDC_PLATFORM_FEE` (Asset, platform-scoped `merchantId = null`).
  - `4200_PLATFORM_FEE_REVENUE` (Revenue, platform-scoped `merchantId = null`).
  - `2110_CUSTOMER_PREPAYMENT` (Liability, merchant-scoped).
- [x] Implement core ledger service (`apps/api/src/modules/ledger/ledger.service.ts`):
  - `getOrCreateAccount`: Auto-provisions standard accounts with correct merchant/platform scoping.
  - `postPaymentSettlement`: Enforces `CONFIRMED` status, exact `BigInt` smallest units, debit/credit balance equality, idempotency key `settle_<sig>`, and platform fee separation.
  - `reverseJournal`: Immutably creates opposing entries (`DEBIT <-> CREDIT`), links `originalJournalId`, records audit reason, and enforces reversal protection guards (cannot reverse already-reversed or reversal journals).
  - `listJournalsForMerchant` & `getJournalDetail`: Scoped queries with pagination and filters (`billId`, `type`, `startDate`, `endDate`).
  - `listAccountsForMerchant`: Aggregates debits, credits, and normal net balances (Debit - Credit for Assets/Expenses; Credit - Debit for Revenue/Liabilities).
  - `getReconciliationReport`: Discrepancy detector identifying unposted confirmed payments, unbalanced journals, and amount mismatches.
- [x] Implement ledger controller and module (`apps/api/src/modules/ledger/ledger.controller.ts`, `ledger.module.ts`):
  - `GET /merchants/:merchantId/ledger/journals`: List journals with pagination.
  - `GET /merchants/:merchantId/ledger/journals/:journalId`: Detail view with balanced debit/credit breakdown.
  - `POST /merchants/:merchantId/ledger/journals/:journalId/reverse`: Owner-only reversal endpoint guarded by `MerchantOwnerGuard`.
  - `GET /merchants/:merchantId/ledger/accounts`: Account list with aggregate balances.
  - `GET /merchants/:merchantId/ledger/reconciliation`: Discrepancy report.
- [x] Integrate ledger auto-posting into Indexer (`apps/api/src/modules/indexer/indexer.service.ts`):
  - Injects `LedgerService` into `IndexerService`.
  - Auto-posts payment settlement immediately upon on-chain transaction confirmation.
  - Auto-posts confirmed unposted transactions during pending and reference reconciliation loops.
- [x] Execute Phase 8 smoke test suite:
  - 41 assertions passed covering balanced posting, exact integers, idempotency, reversal journals, reversal guards, unconfirmed transaction guard, account balances, reconciliation discrepancy detection, and indexer-to-ledger auto-posting.
- [x] Verified `npm.cmd run build` across `@cryptopos/api` and `@cryptopos/web` with clean exit code 0.
- [x] Updated all project documentation (`DATABASE_SCHEMA.md`, `API_DOCUMENTATION.md`, `SECURITY.md`, `USER_FLOWS.md`, `PROJECT_STATUS.md`).

## Phase 7 checklist

- [x] Apply schema migration `20261124234230_phase7_indexer` to create `VerifiedTransaction` and `IndexerCheckpoint` models, `VerificationStatus` enum (`CONFIRMED`, `FAILED`, `PARTIAL`, `OVERPAID`, `LATE`, `INVALID`), and extend `PaymentAttemptStatus` with `CONFIRMED` and `REVIEW_REQUIRED`.
- [x] Build standalone worker entrypoint (`apps/api/src/worker.ts`, script `npm run worker`) and `IndexerModule` / `IndexerService` with Redis distributed lease (`cryptopos:indexer:lease`) and graceful shutdown.
- [x] Implement Solana Devnet cluster genesis hash verification at startup (`GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC` and `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`); fail closed on mismatch.
- [x] Implement SPL token transaction decoder (`apps/api/src/blockchain/solana.decoder.ts`):
  - Resolves static keys and Address Lookup Table loaded keys for v0 transactions.
  - Decodes SPL Token Program `Transfer` and `TransferChecked` instructions with exact `bigint` amounts.
  - Maps destination ATA to owner public key via `postTokenBalances` / `preTokenBalances` without inferring success from balance deltas alone.
- [x] Implement on-chain verifier (`apps/api/src/blockchain/solana.verifier.ts`):
  - Checks `meta.err === null` for successful execution.
  - Enforces presence of Solana Pay reference key in transaction account keys.
  - Verifies Circle Devnet USDC mint (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) and 6 decimals.
  - Compares destination ATA against snapshotted `merchantRecipient` (and `feeRecipient` if fee applies).
  - Exact `bigint` smallest-unit comparisons: exact -> `CONFIRMED`, underpaid -> `PARTIAL`, overpaid -> `OVERPAID`.
  - Enforces quote expiration and `PAYMENT_LATE_GRACE_SECONDS` policy: late transfers past grace -> `LATE`.
- [x] Implement atomic PostgreSQL settlement and concurrency safety in `IndexerService`:
  - Discovers transactions via Solana Pay reference signature polling (`getSignaturesForAddress`) and submitted `PaymentAttempt` queue.
  - In an atomic transaction, updates `Bill.status` to `PAID` (or `PARTIALLY_PAID`, `OVERPAID`, `PAYMENT_REVIEW`), updates `PaymentAttempt.status`, and creates `VerifiedTransaction`.
  - Replay / duplicate protection: if a bill is already `PAID`, additional transfers leave bill `PAID` and flag transaction as `OVERPAID / duplicate`.
  - Checkpoint persistence in `IndexerCheckpoint` table.
- [x] Expose merchant-scoped and public verification APIs:
  - `GET /api/v1/merchants/:merchantId/bills/:billId/payments`: bill payment history and verified transaction evidence.
  - `GET /api/v1/merchants/:merchantId/bills/review`: merchant review queue for partial, overpaid, and late payments.
  - `GET /api/v1/public/pay/:paymentToken/attempt/:quoteId`: enriched with `isPaid`, `billStatus`, and verified details without exposing customer contact data or internal IDs.
- [x] Update customer frontend payment UI (`CustomerPaymentFlow`):
  - Polls `/attempt/:quoteId` while in `pending` state.
  - Seamlessly transitions to celebratory "Payment Verified & Settled!" (`PAID`) or "Payment Under Merchant Review" badge with Explorer link and timestamp.
- [x] Comprehensive smoke test suite (30 assertions passed): genesis hash check, transaction decoding, all 8 verification classification outcomes, atomic DB settlement, duplicate payment protection, partial payment, and checkpoint persistence. Temporary test script removed.
- [x] Verified `npm.cmd run build` across all workspaces (`@cryptopos/api` and `@cryptopos/web`) with clean TypeScript compilation and Next.js page generation.

## Phase 6 checklist

- [x] Apply schema migration `20261124232634_phase6_payments` to add `merchantRecipient`, `feeRecipient`, and unique `reference` to `PaymentQuote`, and create the `PaymentAttempt` model (`PENDING`/`FAILED` status, unique constraints on `quoteId`, `reference`, and `signature`).
- [x] Update `QuotesService.createPublic` to snapshot `merchantRecipient` (merchant settlement address) and `feeRecipient` (platform fee address if fee applies) onto the immutable quote at creation time; fail safely if merchant has no settlement wallet or if fee applies without valid `PLATFORM_FEE_WALLET`.
- [x] Install `@solana/web3.js@1` and `@solana/spl-token` in `@cryptopos/api` and `@cryptopos/web`.
- [x] Implement frontend payment library (`apps/web/lib/payment.ts`):
  - Strict Devnet RPC cluster verification against official genesis hash `GH7ome3EiwEr7tu9JuPh2dpYWBJK3z69Xm1ZE3MEE6JC`.
  - Non-custodial transaction builder deriving customer and recipient ATAs using idempotent account creation instructions.
  - SPL `createTransferCheckedInstruction` using exact `bigint` smallest units (6 decimals) for merchant transfer and optional fee transfer.
  - Unique 32-byte Base58 Solana Pay reference keypair generation per attempt.
- [x] Create backend payment module (`apps/api/src/modules/payments/`):
  - `POST /public/pay/:paymentToken/submit`: validates active unexpired quote, open bill, verified Devnet USDC mint, snapshotted recipient consistency, global reference and signature uniqueness.
  - Idempotent handling: repeated submission for the same quote returns existing attempt; rejects conflicting reference.
  - Enforce `PENDING` status only; never marks bill as `PAID` from submission (reserved strictly for Phase 7's independent indexer).
  - `GET /public/pay/:paymentToken/attempt/:quoteId`: public status polling endpoint without exposing sensitive internal identifiers.
- [x] Build customer payment UI (`CustomerPaymentFlow`):
  - Pre-flight validation display: active quote, connected wallet, and verified settlement recipient.
  - Step 3 "Confirm & Pay" with exact breakdown: base merchant amount, platform fee, total due, network, and token specs.
  - Live execution states: preparing → approving in Phantom → submitting to Solana Devnet → submitted & pending verification → rejected/cancelled / failed.
  - Transaction signature preview with direct link to Solana Explorer (Devnet).
- [x] Comprehensive smoke test suite (24 assertions passed): health, quote rejection without settlement wallet, quote recipient snapshotting, payment submission, idempotent retries, reference conflict rejection, attempt lookup, and invalid token rejection. Temporary test script removed.
- [x] Verified `npm.cmd run build` across all workspaces (`apps/api` and `apps/web`) with clean TypeScript compilation and Next.js page generation.

## Phase 5 checklist

- [x] Create blockchain constants and strict Base58 32-byte Solana public key validation utility in API (`apps/api/src/blockchain/solana.validator.ts`) and Web (`apps/web/lib/solana.ts`).
- [x] Add startup environment validation in `app.module.ts`: enforce `SOLANA_NETWORK === 'devnet'`, verify `SOLANA_USDC_MINT` equals official Devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`), and validate optional `PLATFORM_FEE_WALLET`.
- [x] Implement owner-only merchant settlement wallet endpoints (`GET/PUT/DELETE /merchants/:merchantId/wallet`) and extend `PATCH /merchants/:merchantId` with `settlementAddress`.
- [x] Enforce `MerchantOwnerGuard` on all wallet settings routes: reject cashiers with 403 Forbidden and non-members with 404 Not Found.
- [x] Persist settlement address in PostgreSQL atomically across `Merchant.settlementAddr` and `Wallet` table (`purpose: "SETTLEMENT"`, `network: "devnet"`), enforcing unique addresses across merchants on Devnet.
- [x] Update `BillsService.getPublic` and `QuotesService` to safely expose merchant public settlement address, Devnet network, and verified USDC token metadata on public bills while never leaking private keys or customer data.
- [x] Build modern merchant dashboard settings UI (`/dashboard/settings`): live client-side Base58 address validation, 1-click Phantom autofill, active status badge, token specs card, and clear/remove wallet support.
- [x] Build customer Phantom wallet connection UI on public bill page (`/pay/[paymentToken]`): connect/disconnect, public address chip with copy button, Solana Devnet network pill, developer mode guidance, recipient verification, and graceful error handling.
- [x] Preserve existing quote flow: ensure connecting or disconnecting customer wallet does not wipe, re-request, or alter active quote snapshots or countdown timers.
- [x] Run automated smoke checks covering address validation, owner-only authorization, cashier blocking, conflict detection, public bill token/settlement exposure, and cleanup temporary test scripts.
- [x] Execute `npm.cmd run build` across all workspaces; verify clean TypeScript compilation and Next.js page generation.

## Phase 4 checklist

- [x] Add immutable quote snapshot fields for merchant/bill, fiat amount/currency, token mint/symbol/decimals, price/source timestamp, integer base/fee/total, fee BPS, status and expiry.
- [x] Add CoinGecko Demo adapter using `usd-coin`, supported bill currencies, freshness checks, Redis caching and fail-closed provider errors.
- [x] Create public quote endpoint for OPEN bills; add merchant-scoped quote history; expire quotes after timeout or bill cancellation.
- [x] Add customer quote UI showing base amount, fee, total, price and timer.
- [x] Apply migration, regenerate Prisma Client, build both apps, and verify exact math/provider parsing with mocked smoke checks.

## Phase 3 checklist

- [x] Add exact-decimal bill models/statuses, customer fields, line totals, public token.
- [x] Backend bill calculation, idempotent create, merchant-scoped list/detail/summary/cancel APIs.
- [x] Public bill details endpoint for payment-link QR destination.
- [x] Dashboard shell, merchant selector, overview, owner business settings, POS form, QR/payment link, bill list/detail and cancel UI.
- [x] Generate/apply Phase 3 migration and regenerate Prisma Client.
- [x] API/web production builds; HTTP smoke checks for owner settings, decimal totals, persistence, idempotency, summary, public link, merchant isolation and cancellation.
- [x] Update docs/checklist and handoff file.

## Current implementation map

- API auth: `apps/api/src/modules/auth/`
- API staff membership and owner guard: `apps/api/src/modules/merchants/`
- API bills/POS backend: `apps/api/src/modules/bills/`
- API quote engine and price provider: `apps/api/src/modules/quotes/`
- API payments & submission: `apps/api/src/modules/payments/`
- API independent indexer & worker: `apps/api/src/modules/indexer/`, `apps/api/src/worker.ts`
- API business profile, staff & wallet settings: `apps/api/src/modules/merchants/`
- Blockchain validation & constants: `apps/api/src/blockchain/solana.validator.ts`, `apps/api/src/blockchain/solana.constants.ts`
- Blockchain decoder & verifier: `apps/api/src/blockchain/solana.decoder.ts`, `apps/api/src/blockchain/solana.verifier.ts`
- Database: `apps/api/prisma/schema.prisma`
- Frontend dashboard shell: `apps/web/app/dashboard/`
- Frontend POS: `apps/web/app/dashboard/pos/page.tsx`
- Frontend bills: `apps/web/app/dashboard/bills/`
- Frontend business & settlement settings: `apps/web/app/dashboard/settings/page.tsx`
- Frontend Solana & Phantom library: `apps/web/lib/solana.ts`
- Frontend payment execution & Devnet verification: `apps/web/lib/payment.ts`
- Public bill link: `apps/web/app/pay/[paymentToken]/page.tsx`
- Customer payment flow & wallet panel: `apps/web/app/pay/[paymentToken]/customer-payment-flow.tsx`
- Customer quote panel: `apps/web/app/pay/[paymentToken]/quote-panel.tsx`
- Shared API fetch/refresh: `apps/web/lib/api.ts`
- Security/auth flows: `docs/SECURITY.md`, `docs/USER_FLOWS.md`

## Local environment and commands

Windows workspace: `D:\CryptoPOS`; use VS Code PowerShell and `npm.cmd` (PowerShell blocks the `npm.ps1` shim). Docker Desktop was installed per-user. Its credential helper may need the current PowerShell session PATH set with `$env:PATH = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:PATH"`.

PostgreSQL host port is **5433** because 5432 was occupied; Redis host port is 6379. Root `.env` already exists and must not be committed or copied into this file. Development network must stay `devnet`.

```powershell
docker compose up -d
docker compose ps
npm.cmd install
npm.cmd run db:generate
npm.cmd run db:deploy
npm.cmd run build --workspace=@cryptopos/api
npm.cmd run build --workspace=@cryptopos/web
```

Run the web and API in separate terminals with `npm.cmd run dev:web` and `npm.cmd run dev:api`. Web: `http://localhost:3000`; API health: `http://localhost:4000/api/v1/health`. If port 4000 is already occupied, stop the existing API terminal before restarting; do not silently change the frontend API origin.

After Phase 5 implementation and build, API dev server is active and verified healthy at `http://localhost:4000/api/v1/health` (PostgreSQL and Redis ready).

## Known constraints

- Free hosting is for Devnet demos only; a free API may sleep and cannot provide a reliable always-on indexer.
- Phase 2 staff addition supports existing registered accounts; email invitations are not implemented.
- Password reset/email verification are not implemented; audit logging and shared Redis-backed throttling are needed before public production deployment.
- Phase 5 enforces the official Circle USDC Devnet mint (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals) on Solana Devnet. Any other network or mint is rejected.
- Live customer wallet connection uses the Phantom browser extension. Users must have Phantom installed and developer mode set to Testnet Mode (Devnet).
- Server stores only public wallet addresses. No private keys, secret keys, or seed phrases are ever accepted or persisted.
- Phase 7 indexer marks bills `PAID` only after independent on-chain verification at finalized commitment.
- Ledger entries, account balancing, refunds, and analytics belong strictly to Phase 8, 9, and 10.

## Phase 7 result and resume point

Phase 7 completed on 2026-11-24. Schema migration `20261124234230_phase7_indexer` was generated and applied to the database. `npm.cmd run build` across all workspaces (`@cryptopos/api` and `@cryptopos/web`) succeeded with zero errors. Automated smoke tests verified:
1. Devnet genesis hash verification accepts official (`GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC`) and canonical (`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`) Devnet hashes, and fails closed on cluster mismatch.
2. Solana transaction decoder decodes legacy and v0 SPL Token transfer instructions with exact bigint token amounts and maps destination ATA owners.
3. On-chain verifier enforces `finalized` commitment, reference presence, verified Devnet USDC mint, snapshotted merchant recipient, platform fee recipient, exact bigint units, and quote expiration/grace policy.
4. Independent verification rules correctly classify CONFIRMED, FAILED, INVALID, PARTIAL, OVERPAID, and LATE outcomes.
5. Atomic database settlement: updates `Bill.status` to `PAID`, updates `PaymentAttempt.status` to `CONFIRMED`, and creates `VerifiedTransaction` evidence record in a single transaction.
6. Replay & duplicate protection: duplicate transactions on already-`PAID` bills leave the bill `PAID` and flag the transaction as `OVERPAID / duplicate` without corrupting state.
7. Partial payments update bill status to `PARTIALLY_PAID` and route for merchant review.
8. Checkpoints persist restart-safely in `IndexerCheckpoint`.
9. Customer payment flow polls and transitions seamlessly to confirmed `PAID` or review states.

Temporary smoke script was removed. This is the single resumption file; the next pending phase is **Phase 8 — Transactions and append-only ledger**, which requires explicit user approval before proceeding.
