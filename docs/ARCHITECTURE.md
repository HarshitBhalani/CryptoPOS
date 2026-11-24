# CryptoPOS architecture and Phase 1 plan

## Repository findings

The supplied repository was empty. There were no existing codebases or dependencies to preserve. Node.js 22 is available. Docker and the PowerShell `npm` shim are not available in this environment; use `npm.cmd` for npm commands and install Docker Desktop/Compose to run PostgreSQL and Redis.

## Proposed architecture

Use an npm-workspaces monorepo with `apps/web` (Next.js App Router), `apps/api` (NestJS modular monolith), and PostgreSQL/Redis as local infrastructure in Docker Compose. Prisma is the persistence boundary. Keep future background workers as separate Nest application entrypoints in the API workspace; do not run chain polling in HTTP controllers. The frontend calls versioned REST endpoints under `/api/v1`; SSE will carry persisted status changes later. Blockchain integrations sit behind adapter interfaces, with Solana Devnet as the only enabled network.

## Folder structure

```text
apps/
  web/app/                 Next.js routes and shared UI
  api/src/modules/         Nest modules and HTTP boundary
  api/src/blockchain/       Chain adapter interfaces and implementations
  api/src/workers/          Background worker entrypoints
  api/prisma/schema.prisma  PostgreSQL data model
packages/
  contracts/               Shared API types and schemas (later phase)
docs/                      Architecture and operations documentation
docker-compose.yml          PostgreSQL and Redis for local development
```

## Entity relationships

`User` belongs to merchants through `MerchantMember`; membership carries the business role. A `Merchant` owns wallets, bills and later settings/staff. A `Bill` owns line items, quotes and payment attempts. Quotes snapshot fiat amount, rate, token mint, integer token units, fee and expiry. Verified payments link to bills and quotes; each payment can produce append-only ledger entries and multiple refund records. Network cursors track indexer progress independently per chain. Transaction signatures are unique per network and relevant instruction index. Further entities (Customer, Payment, Transaction, BlockchainNetwork, SupportedToken, ChainCursor, LedgerAccount/Entry, Refund/Approval, Notification, AuditLog, PlatformSetting) will be added in their implementing phases.

## Major API endpoints

All endpoints use `/api/v1` and the envelope `{ success, message, data }`.

| Area | Planned routes |
| --- | --- |
| Health | `GET /health` |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` |
| Merchant | `GET/PATCH /merchants/:merchantId` (owner settings), `GET/POST /merchants/:merchantId/members` (owner-managed staff) |
| Wallets | `GET/PUT/DELETE /merchants/:merchantId/wallet` (owner settlement wallet configuration) |
| Bills | `GET/POST /merchants/:merchantId/bills`, `GET /merchants/:merchantId/bills/summary`, `GET /merchants/:merchantId/bills/:billId`, `POST /merchants/:merchantId/bills/:billId/cancel` |
| Public bill | `GET /public/pay/:paymentToken` |
| Public payment | `GET /public/pay/:token`, `POST /public/pay/:token/quotes` |
| Transactions | `GET /transactions`, `GET /transactions/:id` |
| Refunds | `GET/POST /refunds`, `POST /refunds/:id/approve` |
| Reports/Admin | `/analytics/*`, `/admin/*` |

## Payment lifecycle

Create a bill with backend-calculated totals â†’ issue a time-bounded quote â†’ prepare an unsigned Devnet transaction â†’ customer reviews and signs with Phantom â†’ store signature as submitted â†’ independent worker discovers and verifies the on-chain transfer, including network, mint, recipient, amount, reference and finality â†’ atomically persist payment, bill transition and balanced ledger entries â†’ publish status event. Frontend submission is only a hint and never proof of payment.

## Risks and safe defaults

- No mainnet configuration in the initial project; API environment validation requires `SOLANA_NETWORK=devnet`.
- Token mint and fee recipient remain explicit configuration; blank mint means token payments cannot be enabled.
- All crypto amounts use smallest-unit integers; fiat/accounting uses database Decimal. Never calculate money with JS floating point.
- Platform fee defaults to zero. Refund execution requires merchant-controlled signing and owner approval; no key custody is planned.
- Late-payment and excess-payment handling need explicit policy before payment settlement logic. Default to review state outside exact valid quote conditions.
- Phase 4 price adapter uses CoinGecko Demo and Redis short caching; quote creation fails closed when no fresh provider price exists.
- Real-time transport will be SSE backed by persisted state; polling is the fallback.

## Phase checklist

- [x] Phase 1 architecture, workspace skeleton, environment sample, Docker services, Prisma baseline, API health route, frontend shell.
- [x] Phase 1 acceptance: dependencies installed, Prisma Client generated, database schema synchronized, web and API started, health endpoint confirms PostgreSQL and Redis.
- [x] Phase 2 authentication: registration, login/logout, persisted rotating refresh sessions, cookie JWTs, protected `/auth/me`, global role guard, owner-scoped cashier management, login/register/dashboard routes.
- [x] Phase 2 acceptance: registration/login/logout, refresh rotation, protected profile, owner cashier management and cashier denial verified against PostgreSQL; API and web production builds succeed.
- [x] Phase 3 merchant dashboard and POS: backend-calculated bills, POS, payment links/QR, list/detail/cancel.
- [x] Phase 4 quote engine: price provider/cache, exact integer USDC conversion/fee, immutable expiring quote snapshots, public quote UI/history.
- [x] Phase 5 Solana wallet integration: Base58 32-byte address validator, verified Devnet USDC mint, owner-only merchant settlement API and dashboard UI, public bill settlement exposure, customer Phantom wallet connection and Devnet verification preserving active quotes.
- [x] Phase 6 payment submission: Devnet RPC genesis hash verification, recipient snapshots, SPL token transfer instruction generation, Phantom signAndSendTransaction flow, idempotent PENDING submission recording.
- [x] Phase 7 independent indexer: standalone worker process (`worker.ts`), Redis distributed lease, SPL token instruction decoder, on-chain verification at finalized commitment, atomic settlement, review queue.
- [x] Phase 8 ledger and transactions: append-only double-entry ledger (`LedgerAccount`, `LedgerJournal`, `LedgerEntry`), Chart of Accounts, exact integer unit posting, immutable reversals with owner authorization, reconciliation detector.
- [x] Phase 9 refunds: non-custodial merchant Phantom signing flow, remaining-refundable balance enforcement, platform fee exclusion, owner-only approval/rejection, on-chain verification at finalized commitment, ledger adjustments, bill PARTIALLY_REFUNDED / REFUNDED transitions.
- [x] Phase 10 analytics and admin: merchant sales dashboards and time series, exact integer/decimal arithmetic, platform admin console (`/admin`), merchant status mutation (`ACTIVE` <-> `SUSPENDED`) with immutable `AdminAuditLog` audit trail, suspension enforcement.
- [x] Phase 11 quality and deployment: security audit, multi-origin CORS, security headers, global exception sanitization, request logger, enhanced health/readiness probes, Docker multi-stage containers (`Dockerfile.api`, `Dockerfile.web`, `Dockerfile.worker`), `docker-compose.prod.yml`, `.env.production.example`, and production runbook (`docs/DEPLOYMENT.md`).

## Phase 1 to 11 completion status

All eleven phases of CryptoPOS have been implemented, tested, and verified. The system maintains strict non-custodial operations on Solana Devnet, exact integer financial mathematics, append-only double-entry ledger integrity, and complete operational runbooks.
