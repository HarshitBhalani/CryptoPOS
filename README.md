# CryptoPOS

**A non-custodial cryptocurrency point-of-sale for merchants using Solana Devnet USDC.**

CryptoPOS lets a merchant create a bill, share a checkout link or QR code, and receive USDC directly in the merchant's own Solana wallet. The app handles invoices, quotes, payment verification, accounting records, and refunds; it does not take custody of funds or process credit/debit cards.

> **Development status:** This project is currently restricted to Solana Devnet and test USDC. Do not use it to accept real funds.

## Temporary preview

[Open the current CryptoPOS preview](https://groups-disposition-sur-merger.trycloudflare.com)

This is a temporary Cloudflare Quick Tunnel pointing to the developer's local machine. It works only while the local web app and tunnel process are running; the URL can change when the tunnel restarts. Anyone with the link can reach the exposed app, so use test data only. This is not production hosting or an uptime-guaranteed deployment.

## What the project does

- Creates merchant bills with line items, tax, and a public payment link.
- Calculates a time-limited USDC quote from the bill's fiat total.
- Lets a customer connect Phantom and approve a wallet transaction.
- Sends payment directly to the merchant's settlement wallet.
- Independently checks Solana Devnet transactions before marking bills paid.
- Records confirmed payments in a balanced double-entry ledger.
- Supports owner-controlled refunds, merchant analytics, and platform administration.

### Payment flow

1. The merchant configures a public settlement wallet address.
2. The cashier creates a bill in the POS.
3. The API creates a time-limited USDC quote using the configured price provider.
4. The customer reviews the bill and approves the transfer in Phantom.
5. A separate worker verifies the finalized Devnet transaction, including mint, amount, recipient, and payment reference.
6. The API updates the bill and posts accounting entries after verification.

The browser's payment result is not treated as proof by itself. The worker checks the blockchain independently.

## Solana and wallet safety

- **Network:** Solana Devnet only.
- **Token:** Circle Devnet USDC, mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU, 6 decimals.
- **Wallet:** Phantom provides customer and merchant transaction approval.
- **Custody:** CryptoPOS never asks for or stores a seed phrase or private key. Funds go directly to the merchant wallet.
- **Pricing:** Fiat-to-USDC quotes use the configured price provider; a CoinGecko API key is optional for live quotes.
- **Cards:** No credit/debit-card processor is integrated.

Devnet tokens are for testing and have no real-world value. Keep Phantom in Devnet/Testnet mode while using this project.

## Technology stack and why it is used

| Technology | Used for | Why |
| --- | --- | --- |
| Next.js 15, React 19, TypeScript | Merchant dashboard, POS, and customer checkout | App Router organizes page flows; TypeScript helps catch UI and API-shape mistakes. |
| NestJS 11, TypeScript | REST API and background worker | Modules separate authentication, merchants, bills, payments, refunds, analytics, and admin logic. |
| PostgreSQL 16, Prisma | Users, merchants, bills, quotes, verified transactions, ledger, and audit records | Relational constraints and transactions protect connected financial records; migrations make schema changes repeatable. |
| Redis 7 | Rate limiting, price cache, and worker lease | Shares short-lived state and prevents multiple workers from indexing the same stream concurrently. |
| Solana Web3.js and SPL Token | Solana RPC and USDC transaction handling | Reads Devnet state and works with the USDC token program. |
| Phantom | Wallet connection and transaction approval | The wallet owner signs; CryptoPOS never receives wallet secrets. |
| Docker Compose | Local PostgreSQL and Redis services | Starts development dependencies consistently on one machine. |
| Cloudflare Quick Tunnel | Temporary remote preview of the local web app | Shares a local HTTPS link without deploying the application; development use only. |

## Architecture

- **Web:** Next.js serves the merchant dashboard, POS, and customer checkout.
- **API:** NestJS handles authentication, merchant access, bills, quotes, payment state, refunds, analytics, and administration.
- **Database:** PostgreSQL stores application records; Prisma manages schema migrations and database access.
- **Cache and coordination:** Redis supports rate limiting, price caching, and the indexer's distributed lease.
- **Indexer:** A separate NestJS worker reads finalized Solana Devnet transactions and sends verified results to the application database.
- **Wallet signing:** Phantom signs transactions in the user's browser. The API never stores private keys.

The API verifies the mint, amount, destination, and payment reference. Client-submitted transaction details alone cannot mark a bill as paid.

## Local development

### Requirements

- Node.js 20 or newer
- npm
- Docker Desktop with Docker Compose
- Phantom browser extension for wallet-flow testing

### Setup

Clone the repository and install dependencies:

    git clone https://github.com/HarshitBhalani/CryptoPOS.git
    cd CryptoPOS
    npm install

Copy the environment template to a local, untracked file:

    Copy-Item .env.example .env

In Bash, use: cp .env.example .env. Review .env and set strong local JWT secrets. Never commit .env.

Start PostgreSQL and Redis:

    docker compose up -d

Generate the Prisma client and apply database migrations:

    npm.cmd run db:generate
    npm.cmd run db:deploy

On Linux or macOS, use npm instead of npm.cmd.

Run each process in its own terminal from the repository root:

    npm.cmd run dev:api
    npm.cmd run worker
    npm.cmd run dev:web

The web app is at http://localhost:3000. The API health endpoint is http://localhost:4000/api/v1/health. To create a temporary public preview, start a Quick Tunnel in another terminal:

    cloudflared tunnel --url http://localhost:3000

Open the HTTPS URL printed by cloudflared. Keep Docker, API, worker, web, and tunnel running while testing payment verification. If the tunnel creates a new hostname, use the new URL and update the Next.js development-origin allowlist if required.

## Production

The Quick Tunnel is not production hosting. Production requires an always-on API and indexer worker, persistent database storage, production secrets, HTTPS, backups, monitoring, and a stable domain. See the [Production Deployment Runbook](docs/DEPLOYMENT.md).

## Project documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Database schema](docs/DATABASE_SCHEMA.md)
- [API documentation](docs/API_DOCUMENTATION.md)
- [Security](docs/SECURITY.md)
- [User flows](docs/USER_FLOWS.md)
- [Deployment runbook](docs/DEPLOYMENT.md)
- [Project status and AI handoff](PROJECT_STATUS.md)

## Build

Build all workspaces:

    npm.cmd run build

On Linux or macOS, use npm run build.
