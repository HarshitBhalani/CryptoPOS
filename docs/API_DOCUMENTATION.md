# API reference

Base path: `/api/v1`. Successful responses use `{ success, message, data }`. Access and refresh tokens are HTTP-only cookies; they are not returned in response JSON. All protected routes require a valid access cookie or `Authorization: Bearer <token>`.

## Authentication

| Method | Route | Access |
| --- | --- | --- |
| POST | `/auth/register` | Public; creates owner, merchant and owner membership atomically |
| POST | `/auth/login` | Public |
| POST | `/auth/refresh` | Refresh cookie; rotates persisted session |
| POST | `/auth/logout` | Public; revokes refresh cookie session and clears cookies |
| GET | `/auth/me` | Authenticated |

Registration body: `{ name, email, password, businessName, businessType? }`. Password length: 12–128 characters. Login body: `{ email, password }`.

## Business, staff and wallet settings

| Method | Route | Access |
| --- | --- | --- |
| GET | `/merchants/:merchantId` | Merchant owner or platform admin |
| PATCH | `/merchants/:merchantId` | Merchant owner or platform admin; accepts `name?`, `businessType?`, `settlementAddress?` |
| GET | `/merchants/:merchantId/members` | Merchant owner or platform admin |
| POST | `/merchants/:merchantId/members` | Merchant owner or platform admin; body `{ email }`; adds an existing user as cashier |
| GET | `/merchants/:merchantId/wallet` | Merchant owner or platform admin; returns Devnet settlement wallet status and token metadata |
| PUT | `/merchants/:merchantId/wallet` | Merchant owner or platform admin; body `{ settlementAddress }`; validates 32-byte Base58 Solana public key |
| DELETE | `/merchants/:merchantId/wallet` | Merchant owner or platform admin; unlinks settlement wallet |

All merchant routes enforce active merchant membership. Cashiers cannot access or modify wallet settings (403 Forbidden). Nonmembers receive not-found (404) responses to prevent merchant enumeration. Settlement addresses must be valid 32-byte Base58 Solana public keys and must be unique across merchants on Devnet.

## Bills

| Method | Route | Access |
| --- | --- | --- |
| POST | `/merchants/:merchantId/bills` | Active merchant owner/cashier; requires `Idempotency-Key` header (16–128 characters) |
| GET | `/merchants/:merchantId/bills?page=1&pageSize=20&status=OPEN&search=...` | Active merchant owner/cashier |
| GET | `/merchants/:merchantId/bills/summary` | Active merchant owner/cashier |
| GET | `/merchants/:merchantId/bills/review` | Active merchant owner/cashier; lists bills requiring payment review (partial, overpaid, late) |
| GET | `/merchants/:merchantId/bills/:billId` | Active merchant owner/cashier |
| GET | `/merchants/:merchantId/bills/:billId/quotes` | Active merchant owner/cashier; latest 50 quote snapshots |
| GET | `/merchants/:merchantId/bills/:billId/payments` | Active merchant owner/cashier; verified on-chain transactions and submission attempts |
| POST | `/merchants/:merchantId/bills/:billId/cancel` | Active merchant owner/cashier; only an `OPEN` bill can be cancelled |
| GET | `/merchants/:merchantId/ledger/journals` | Active merchant owner/cashier; paginated journals with filters (`billId`, `type`, `startDate`, `endDate`) |
| GET | `/merchants/:merchantId/ledger/journals/:journalId` | Active merchant owner/cashier; journal detail with balanced debit/credit entries |
| POST | `/merchants/:merchantId/ledger/journals/:journalId/reverse` | Merchant owner only; body `{ reason }`; creates immutable reversal journal with opposing entries |
| GET | `/merchants/:merchantId/ledger/accounts` | Active merchant owner/cashier; chart of accounts with aggregate debits, credits, and net balances |
| GET | `/merchants/:merchantId/ledger/reconciliation` | Active merchant owner/cashier; detects unposted payments, unbalanced journals, and amount mismatches |
| POST | `/merchants/:merchantId/refunds` | Active merchant owner/cashier; body `{ verifiedTxId, amountUnits, reason, destinationWallet? }`; header `Idempotency-Key`; creates refund request in `REQUESTED` state |
| GET | `/merchants/:merchantId/refunds?billId=...&status=...` | Active merchant owner/cashier; lists paginated refunds |
| GET | `/merchants/:merchantId/refunds/summary/:billId` | Active merchant owner/cashier; refundable balance breakdown and non-refundable platform fee disclosure |
| GET | `/merchants/:merchantId/refunds/:refundId` | Active merchant owner/cashier; refund detail with audit log and linked ledger adjustment |
| POST | `/merchants/:merchantId/refunds/:refundId/approve` | Merchant owner only; transitions to `APPROVED`, generates unique Solana Pay reference, returns signing payload |
| POST | `/merchants/:merchantId/refunds/:refundId/reject` | Merchant owner only; body `{ reason }`; transitions to `REJECTED`, releases reserved balance |
| POST | `/merchants/:merchantId/refunds/:refundId/submit` | Merchant owner only; body `{ signature }`; records broadcast signature and transitions to `PENDING` |
| POST | `/merchants/:merchantId/refunds/:refundId/verify` | Active merchant owner/cashier; verifies on-chain finalization, marks `CONFIRMED`, updates bill status, and posts ledger adjustment |
| GET | `/merchants/:merchantId/analytics/overview?startDate=...&endDate=...` | Active merchant owner/cashier; audited overview metrics (gross/net sales units & formatted, refunds, fees, average payment, bill distribution, ledger integrity) |
| GET | `/merchants/:merchantId/analytics/series?startDate=...&endDate=...` | Active merchant owner/cashier; daily financial time series breakdown |
| GET | `/admin/overview` | Platform admin only; platform-wide volume, merchant counts, indexer health, and ledger health |
| GET | `/admin/merchants?page=1&pageSize=20&search=...&status=...` | Platform admin only; paginated merchants list with volume and owner metadata |
| GET | `/admin/merchants/:merchantId` | Platform admin only; detailed merchant status, members, wallet settings, volume, and audit logs |
| PATCH | `/admin/merchants/:merchantId/status` | Platform admin only; body `{ status, reason }`; mutates merchant status and creates `AdminAuditLog` |
| GET | `/admin/audit-logs?page=1&pageSize=25&action=...` | Platform admin only; paginated immutable admin audit logs |
| GET | `/admin/ledger/reconciliation` | Platform admin only; system-wide double-entry ledger reconciliation report auditing all journals |
| GET | `/public/pay/:paymentToken` | Public, high-entropy token |
| POST | `/public/pay/:paymentToken/quotes` | Public; creates a live 120-second USDC Devnet quote for an open bill with snapshotted recipients |
| POST | `/public/pay/:paymentToken/submit` | Public; records signed payment attempt with status `PENDING` |
| GET | `/public/pay/:paymentToken/attempt/:quoteId` | Public; polls payment attempt submission status |

Create body:

```json
{
  "currency": "USD",
  "taxRate": "7.5",
  "description": "Optional bill note",
  "customerName": "Optional customer",
  "customerEmail": "customer@example.com",
  "items": [{ "description": "Service", "quantity": "2", "unitPrice": "10.25" }]
}
```

Supported currencies: USD, AUD, CAD, EUR, GBP, INR. Quantity and unit price are decimal strings with up to six fractional places. The backend calculates line totals, subtotal, tax and total using Prisma Decimal; money fields are returned as fixed two-decimal strings. A repeated idempotency key returns the original bill if its normalized payload matches; a different payload receives conflict.

Public bill response:
`GET /public/pay/:paymentToken` returns bill details, items, totals, plus non-custodial settlement metadata:
- `merchant`: `{ name: string, settlementAddress: string | null }`
- `network`: `"devnet"`
- `supportedToken`: `{ symbol: "USDC", name: "USD Coin (Devnet)", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: 6, network: "devnet" }`
- `isSettlementConfigured`: boolean

Customer contact details, password hashes, and private keys are never returned on public endpoints.

## Quotes

`POST /public/pay/:paymentToken/quotes` creates a new immutable quote only while its bill is `OPEN`. Response quote includes fiat amount/currency, price per USDC, base/fee/total USDC amounts and smallest-unit integers, verified Devnet mint, provider timestamp, fee basis points, status, expiry, network (`devnet`), and `merchantSettlementAddress`.

Conversion and fee rounding use integer arithmetic; both base amount and fee round up to avoid under-quoting. New requests create new snapshots; expired quotes are never silently repriced. Quote history marks elapsed active snapshots as `EXPIRED`, and bill cancellation expires remaining active quotes atomically.

Price lookup uses CoinGecko Demo `/simple/price` with `usd-coin`, the bill currency, and `include_last_updated_at=true`; Redis cache TTL defaults to 15 seconds and maximum accepted provider age to 120 seconds. Provider errors, missing key or stale prices fail closed. Set `PRICE_PROVIDER_API_KEY` in root `.env` to a CoinGecko Demo API key. Config: `QUOTE_TTL_SECONDS` (default 120), `PLATFORM_FEE_BPS` (default 0), `PRICE_CACHE_TTL_SECONDS` (default 15), `PRICE_MAX_AGE_SECONDS` (default 120), `SOLANA_USDC_MINT` (verified Devnet USDC: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`). This phase does not submit wallet transactions.

## Payments (Phase 6)

`POST /public/pay/:paymentToken/submit`
Public endpoint for recording customer-submitted Solana Devnet payment transactions.

Body:
```json
{
  "quoteId": "cuid...",
  "reference": "SolanaPayReferencePubkeyBase58",
  "signature": "SolanaTransactionSignatureBase58",
  "customerWallet": "CustomerWalletPubkeyBase58"
}
```

Behavior:
1. Validates `customerWallet` and `reference` are valid Base58 Solana public keys.
2. Loads quote and checks:
   - Associated bill is `OPEN`.
   - Quote is `ACTIVE` and `expiresAt > now()`.
   - Quote recipient snapshot matches settlement configuration.
   - Quote mint is verified Devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) with 6 decimals.
3. Checks idempotency: if `PaymentAttempt` already exists for `quoteId`:
   - Returns existing attempt if `reference` matches.
   - Rejects with `409 Conflict` if attempting to change reference.
4. Checks global reference and signature uniqueness.
5. Persists `PaymentAttempt` with status `PENDING`.
6. **Important:** Never marks the bill as `PAID`. Payment success verification is delegated entirely to Phase 7's independent on-chain indexer.

Response:
```json
{
  "data": {
    "attempt": {
      "id": "cuid...",
      "quoteId": "cuid...",
      "billId": "cuid...",
      "reference": "...",
      "signature": "...",
      "status": "PENDING",
      "submittedAt": "2026-11-24T...",
      "updatedAt": "2026-11-24T..."
    }
  }
}
```

`GET /public/pay/:paymentToken/attempt/:quoteId`
Returns the current `PaymentAttempt` and on-chain verification status for a quote, without exposing sensitive identifiers.

Response:
```json
{
  "data": {
    "attempt": {
      "id": "cuid...",
      "quoteId": "cuid...",
      "billId": "cuid...",
      "reference": "...",
      "signature": "...",
      "status": "CONFIRMED",
      "billStatus": "PAID",
      "isPaid": true,
      "verified": {
        "status": "CONFIRMED",
        "reviewReason": null,
        "verifiedAt": "2026-11-24T...",
        "blockTime": "2026-11-24T..."
      },
      "submittedAt": "2026-11-24T...",
      "updatedAt": "2026-11-24T..."
    }
  }
}
```

## Indexer and worker (Phase 7)

Standalone worker entrypoint: `npm run worker` (runs `apps/api/src/worker.ts`).
- Verifies official Devnet genesis hash at startup; fails closed on mismatch.
- Obtains Redis distributed lease (`cryptopos:indexer:lease`) to avoid duplicate worker races.
- Discovers candidate transactions via Solana Pay reference signature polling and pending attempt queue.
- Fetches transactions at `finalized` commitment with `maxSupportedTransactionVersion: 0`.
- Decodes SPL Token Program transfers with exact integer amounts (`bigint`, 6 decimals).
- Settles bills atomically in database transactions; preserves checkpoints in `IndexerCheckpoint`.
