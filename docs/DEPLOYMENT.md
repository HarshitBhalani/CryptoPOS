# CryptoPOS Production Deployment & Operational Runbook

This document details the production deployment architecture, hosting provider comparison, operational runbooks, and disaster recovery procedures for CryptoPOS.

---

## 1. Production Architecture Overview

CryptoPOS consists of five core services:

```text
               +----------------------------------------------------+
               |                Reverse Proxy / TLS                 |
               |         (Cloudflare / Caddy / Nginx / Traefik)     |
               +-------------------------+--------------------------+
                                         |
                         +---------------+---------------+
                         |                               |
                   HTTPS (Port 3000)               HTTPS (Port 4000)
                         |                               |
                 +-------v-------+               +-------v-------+
                 |  apps/web     |               |  apps/api     |
                 |  (Next.js)    |               |  (NestJS)     |
                 +---------------+               +-------+-------+
                                                         |
         +-----------------------------------------------+---------------------------------------+
         |                                               |                                       |
 +-------v-------+                               +-------v-------+                       +-------v-------+
 |  PostgreSQL   | <---------------------------- | Standalone    |                       |     Redis     |
 |  (v16 Alpine) |                               | Indexer Worker| --------------------> |  (v7 Alpine)  |
 |  [Port 5432]  |                               | apps/api/dist/| [Distributed Lease]   |  [Port 6379]  |
 +---------------+                               | worker.js     |                       +---------------+
                                                 +-------+-------+
                                                         |
                                                 [Solana Devnet]
                                                 (RPC Finalized Reads)
```

1. **`web` (`apps/web`)**: Next.js App Router providing merchant dashboard, POS terminal, and customer checkout UI.
2. **`api` (`apps/api`)**: NestJS modular REST API handling bills, quotes, merchant settings, ledger queries, and platform admin.
3. **`worker` (`apps/api/dist/worker.js`)**: Standalone background worker independently indexing on-chain transactions and verifying finalized payments/refunds on Solana Devnet.
4. **`postgres`**: Relational database with persistent NVMe volume, holding bills, quotes, verified transaction evidence, append-only double-entry ledger entries, and audit logs.
5. **`redis`**: In-memory cache for distributed worker leases (`cryptopos:indexer:lease`), rate limiting, price caching, and session tracking.

---

## 2. Critical Notice: Free / Sleeping Hosts Are Unsuitable

> [!CAUTION]
> **Free or sleeping hosting tiers (e.g. Render free tier, Heroku Eco, Koyeb free, Glitch) MUST NOT be used for CryptoPOS.**

### Technical Explanation
- **Sleep / Idle Timeout:** Free tiers automatically spin down containers after 10–15 minutes of inbound HTTP inactivity.
- **Worker Starvation:** When a container sleeps, the background Solana indexer worker ceases execution.
- **Payment Failure:** If a customer pays a bill while the worker is asleep, the transaction is not detected within the quote validity or grace window. Bills remain stuck in `PENDING`, causing cashier confusion and customer dissatisfaction.
- **Database Expiration:** Free cloud databases (e.g. Render free PostgreSQL) expire and delete data after 30 days.

**Rule:** Both the NestJS API server and the standalone background worker must run on **always-on**, uninterrupted computing instances with persistent storage.

---

## 3. Hosting Providers & Verified Pricing Comparison

| Provider | Service Type | Monthly Pricing Estimate | Always-On Indexer Worker | Persistent Storage | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hetzner Cloud / DigitalOcean / Linode** | Self-Hosted Linux VPS (Docker Compose) | **$4.00 – $12.00 / mo**<br>(e.g. Hetzner CX22: 2 vCPU, 4GB RAM, 40GB NVMe = €3.79/mo) | **Native / Full** (unrestricted daemon process) | Dedicated NVMe disk with automated snapshots | **Recommended for lowest cost & full stack control** |
| **Railway** | Managed Container PaaS | **$10.00 – $20.00 / mo**<br>($5 base + compute $0.000231/GB-hr RAM) | **Native / Full** (worker process runs 24/7) | Persistent volume support for PostgreSQL & Redis | **Recommended for easiest zero-ops deployment** |
| **Fly.io** | Distributed Edge Containers | **$12.00 – $25.00 / mo**<br>(~$3–$5 per always-on 512MB VM) | **Supported** (requires `auto_stop_machines = false`) | Persistent volume mounts | **Good alternative for low-latency global edge** |
| **Render** | Managed Cloud Platform | **$28.00+ / mo**<br>(Web $7 + API $7 + Worker $7 + Postgres $7) | **Requires paid Starter tier** (Free tier sleeps and does not support workers) | Paid managed PostgreSQL & Redis | **Acceptable on paid tiers; prohibitively expensive compared to VPS** |

---

## 4. Production Deployment Runbook (Docker Compose on Linux VPS)

### Step 1: Server Provisioning & Base Security
1. Provision a clean Ubuntu 22.04 LTS or Debian 12 64-bit instance (minimum 2 vCPU, 2GB RAM, 30GB SSD).
2. Configure SSH key authentication and disable root password login in `/etc/ssh/sshd_config`.
3. Enable Uncomplicated Firewall (UFW):
   ```bash
   sudo ufw default deny incoming
   sudo ufw default allow outgoing
   sudo ufw allow 22/tcp
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   sudo ufw enable
   ```
4. Install Docker Engine and Docker Compose V2:
   ```bash
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl gnupg
   sudo install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
   sudo chmod a+r /etc/apt/keyrings/docker.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
   sudo apt-get update
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   ```

### Step 2: Repository Deployment & Environment Setup
1. Clone the repository to `/opt/cryptopos`:
   ```bash
   sudo git clone https://github.com/your-org/cryptopos.git /opt/cryptopos
   cd /opt/cryptopos
   ```
2. Create `.env.production` from `.env.production.example`:
   ```bash
   cp .env.production.example .env.production
   chmod 600 .env.production
   ```
3. Generate cryptographically strong random secrets:
   ```bash
   # Generate PostgreSQL password
   openssl rand -hex 24
   # Generate JWT_SECRET
   openssl rand -base64 48
   # Generate JWT_REFRESH_SECRET
   openssl rand -base64 48
   ```
4. Edit `.env.production` using `nano .env.production` and set:
   - `DATABASE_URL` with the same generated password entered in `POSTGRES_PASSWORD`. Use the internal Compose host `postgres:5432`; keep the password hex-only so it needs no URL encoding.
   - `JWT_SECRET` and `JWT_REFRESH_SECRET`.
   - `FRONTEND_URL` and `BACKEND_URL` with your production domains (e.g. `https://pos.example.com`).
   - `NEXT_PUBLIC_API_URL` to `https://api.example.com/api/v1`; the web Docker build embeds this URL. The frontend and API custom domains must share the same parent domain for the current secure `SameSite=Lax` auth cookies.
   - `SOLANA_NETWORK=devnet` and `SOLANA_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
   - A CoinGecko Demo key in `PRICE_PROVIDER_API_KEY` to enable quote creation. Leave `PLATFORM_FEE_WALLET` blank only while `PLATFORM_FEE_BPS=0`.

### Step 3: Database Migrations & Initial Stack Startup
1. Start infrastructure services first:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
   ```
2. Verify database health:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml ps
   ```
3. Apply all Prisma migrations:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml run --rm api npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
   ```
4. Build and start all application services:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
   ```
5. Verify container health:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml ps
   ```

### Step 4: Reverse Proxy & Automated SSL (Caddy Example)
Install Caddy for zero-configuration automatic Let's Encrypt TLS:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLF 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLF 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

Configure `/etc/caddy/Caddyfile`:
```caddy
pos.example.com {
    reverse_proxy localhost:3000
}

api.example.com {
    reverse_proxy localhost:4000
}
```

Reload Caddy:
```bash
sudo systemctl reload caddy
```

---

## 5. Database Backup and Disaster Recovery

### Automated Daily Backups
Create a backup script `/opt/cryptopos/scripts/backup.sh`:
```bash
#!/bin/bash
set -euo pipefail

BACKUP_DIR="/var/backups/cryptopos"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="${BACKUP_DIR}/cryptopos_${DATE}.sql.gz"

mkdir -p "${BACKUP_DIR}"

# Execute pg_dump inside the container and compress
docker compose --env-file /opt/cryptopos/.env.production -f /opt/cryptopos/docker-compose.prod.yml exec -T postgres \
  pg_dump -U cryptopos -d cryptopos | gzip > "${FILENAME}"

# Retain backups for 14 days
find "${BACKUP_DIR}" -type f -name "cryptopos_*.sql.gz" -mtime +14 -delete

echo "Backup successful: ${FILENAME}"
```

Make executable and register with cron:
```bash
chmod +x /opt/cryptopos/scripts/backup.sh
# Add to root crontab: 0 2 * * * /opt/cryptopos/scripts/backup.sh >> /var/log/cryptopos_backup.log 2>&1
```

### Disaster Recovery / Database Restoration Drill
To restore the database from a backup file:
```bash
gunzip -c /var/backups/cryptopos/cryptopos_20261125_000000.sql.gz | \
  docker compose --env-file /opt/cryptopos/.env.production -f /opt/cryptopos/docker-compose.prod.yml exec -T postgres \
  psql -U cryptopos -d cryptopos
```

---

## 6. Health Checks, Monitoring & Alerting

### API Health Endpoints
- **Liveness Probe:** `GET /api/v1/health/live`
  - Returns HTTP 200 `{ status: "alive", uptimeSeconds: ... }`.
  - Used by load balancers and container restart orchestrators.
- **Readiness Probe:** `GET /api/v1/health`
  - Returns HTTP 200 (healthy) or HTTP 503 (unhealthy).
  - Validates PostgreSQL connection latency, Redis PING, Solana Devnet RPC slot, and Indexer checkpoint status.

### Recommended External Uptime Monitoring
Set up external monitoring (e.g. BetterStack, UptimeRobot, or Datadog) to ping:
1. `https://api.example.com/api/v1/health` (every 60 seconds; alert on HTTP 503).
2. `https://pos.example.com` (every 60 seconds; alert on HTTP non-200).

---

## 7. Zero-Downtime Rolling Update Procedure

When deploying code updates:
```bash
cd /opt/cryptopos

# 1. Pull latest verified commits
git pull origin main

# 2. Run database migrations safely
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm api npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

# 3. Rebuild and restart services with zero disruption
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build --no-deps api web worker

# 4. Verify post-deployment health check
curl -f http://localhost:4000/api/v1/health
```
