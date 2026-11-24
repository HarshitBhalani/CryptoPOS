# CryptoPOS

> **Non-custodial cryptocurrency Point-of-Sale (POS) terminal, payments engine, and double-entry accounting ledger on Solana Devnet.**

CryptoPOS enables brick-and-mortar and online merchants to accept USD Coin (USDC) payments directly into their own merchant-controlled wallets on Solana Devnet without third-party custody, chargeback risk, or centralized intermediary holding.

---

## Key Features

- **Non-Custodial Architecture:** Funds transfer directly from the customer's wallet (e.g. Phantom) to the merchant's on-chain settlement wallet. The platform never holds, signs, or controls private keys.
- **Strict Network & Mint Isolation:** Pinned strictly to Solana Devnet with official Circle Devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals) and on-chain RPC genesis hash verification (`GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC` and `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`).
- **Cryptographic Pricing & Quote Engine:** Backend-calculated bills with exact integer smallest-unit conversions, live CoinGecko rate caching, and 120-second immutable quote snapshots capturing snapshotted recipient addresses.
- **Independent On-Chain Indexer:** Standalone background worker (`npm run worker`) querying Solana Devnet RPC at `finalized` commitment. Decodes SPL token instructions, enforces Solana Pay reference uniqueness, and handles late/partial/overpaid transactions atomically. Client submissions are strictly treated as hints, never payment proof.
- **Immutable Append-Only Double-Entry Ledger:** Full double-entry accounting system with standard Chart of Accounts (`1110` Settlement Asset, `4100` Sales Revenue, `1120` Platform Fee Asset, `4200` Fee Revenue, `2110` Prepayments). Every confirmed transaction posts balanced debit/credit journals. Supports owner-authorized reversals and discrepancy reconciliation.
- **Auditable Non-Custodial Refunds:** Full and partial refunds signed directly by the merchant's Phantom wallet. Enforces remaining-refundable balance caps, platform fee exclusion, owner-only authorization, independent finalized verification, and automated ledger adjustments.
- **Merchant Analytics & Platform Admin Tools:** Real-time dashboards with exact integer crypto KPIs, segregated fiat totals, continuous daily time series, bill status distribution, platform overview, merchant directory with status mutation (`ACTIVE` <-> `SUSPENDED`), and immutable `AdminAuditLog` records.
- **Enterprise Security & Reliability:** Multi-origin CORS, security headers, rate limiting (Throttler), cookie-based JWT authentication with rotating refresh sessions, global exception sanitization, graceful shutdown hooks, and comprehensive health/readiness probes (`/api/v1/health` and `/api/v1/health/live`).

---

## Architecture & Technology Stack

- **Frontend (`apps/web`):** Next.js 15 (App Router), React 19, TypeScript, responsive dark-mode POS terminal and merchant dashboard.
- **API Server (`apps/api`):** NestJS 11, TypeScript, Prisma ORM, Redis client, Express, validation pipes.
- **Indexer Worker (`apps/api/src/worker.ts`):** Standalone NestJS worker process with distributed Redis lease (`cryptopos:indexer:lease`) and Solana Web3.js.
- **Database:** PostgreSQL 16 with exact database `Decimal` and `BigInt` columns.
- **Cache & Message Broker:** Redis 7 for distributed leases, session management, and rate limiting.

Documentation:
- [System Architecture](docs/ARCHITECTURE.md)
- [Database Schema & Migrations](docs/DATABASE_SCHEMA.md)
- [API Documentation](docs/API_DOCUMENTATION.md)
- [Security Foundation](docs/SECURITY.md)
- [User Flows & Lifecycles](docs/USER_FLOWS.md)
- [Production Deployment & Runbook](docs/DEPLOYMENT.md)
- [Project Status & AI Handoff](PROJECT_STATUS.md)

---

## Local Development Quickstart

### Prerequisites
- **Node.js**: v20 or higher
- **Package Manager**: npm 10+
- **Docker**: Docker Engine & Docker Compose

### 1. Clone & Install
```bash
git clone https://github.com/your-org/cryptopos.git
cd cryptopos
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Ensure PostgreSQL port (`5433` by default to avoid host collisions) and Redis port (`6379`) match your local environment.

### 3. Start Database & Redis
```bash
docker compose up -d
```

### 4. Database Setup
```bash
npm run db:generate
npm run db:deploy
```

### 5. Run Applications
In separate terminal sessions:
```bash
# Terminal 1: Run NestJS API server (http://localhost:4000)
npm run dev:api

# Terminal 2: Run Next.js Web Frontend (http://localhost:3000)
npm run dev:web

# Terminal 3: Run Standalone Solana Indexer Worker
npm run worker
```

---

## Production Deployment

CryptoPOS includes production-ready Docker containers and orchestration:

- **`Dockerfile.api`**: Multi-stage production container for the NestJS API server.
- **`Dockerfile.web`**: Multi-stage production container for the Next.js frontend.
- **`Dockerfile.worker`**: Multi-stage production container for the standalone payment indexer.
- **`docker-compose.prod.yml`**: Full-stack production compose configuration with persistent volumes, resource limits, and health checks.
- **`.env.production.example`**: Production environment template.

For detailed hosting options, pricing comparison, database backup scripts, and zero-downtime rolling update instructions, see **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

> [!CAUTION]
> **Do not use free or sleeping hosting tiers (e.g. Render free tier, Heroku Eco) for the API or Worker.** Free tiers sleep after inactivity, which stops the Solana indexer from verifying and confirming customer payments.

---

## Testing & Verification

Run the full build across all workspaces:
```bash
npm run build
```

Run database migration status:
```bash
npx prisma migrate status --schema apps/api/prisma/schema.prisma
```
