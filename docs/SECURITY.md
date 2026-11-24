# Security foundation

## Authentication

- Passwords are hashed with bcryptjs using cost factor 12; raw passwords are never stored or returned.
- Access JWTs are held in HTTP-only cookies and expire after one hour. Refresh JWTs are held in HTTP-only cookies scoped to `/api/v1/auth` and expire after 30 days.
- Only a SHA-256 hash of each refresh token is stored. Refresh rotates the token in a database transaction; reuse of a revoked refresh token revokes the user's active sessions.
- Cookies use `SameSite=Lax`; `Secure` is enabled in production. CORS allows only the configured frontend origin with credentials.
- All JWT secrets must be distinct random values of at least 32 characters. The API refuses non-Devnet network configuration.

## Authorization and isolation

- `JwtAuthGuard` verifies the access JWT on protected endpoints. `RolesGuard` applies global role metadata.
- Merchant staff operations require an active merchant membership with owner role; platform admins have a separate bypass.
- Staff can only be added as cashiers, and only to a merchant whose owner makes the request. Cashier promotion and owner wallet controls are not exposed.
- Passwords, JWTs, cookies and refresh-token hashes are excluded from API responses.
- API requests are throttled in memory at 100/minute per client; registration and login are limited to 5/minute and refresh to 10/minute. Use shared Redis-backed throttler storage before running multiple API instances.

## Non-custodial wallet and blockchain security

- **Public keys only:** The server never stores, receives, or handles private keys, seed phrases, or wallet signing credentials.
- **Strict Base58 32-byte public key validation:** All Solana addresses undergo strict cryptographic validation. Decoded bytes must equal 32 bytes and re-encode to the canonical input.
- **Strict Devnet enforcement:** Configuration refuses any network other than `devnet`. Startup validation enforces the official verified Devnet USDC mint (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals) and rejects Mainnet or alternative mints.
- **Owner-only settlement configuration:** Settlement wallet settings (`GET/PUT/DELETE /merchants/:merchantId/wallet`) require active owner membership. Cashiers receive 403 Forbidden; non-members receive 404 Not Found to prevent merchant ID enumeration.
- **Client-side wallet connection:** Customer Phantom connection operates entirely in the browser via window provider APIs. No transaction signing occurs in Phase 5.
- **Public data safety:** Public bill and quote endpoints expose only public settlement addresses and token metadata, with zero exposure of customer emails, user credentials, or internal identifiers.

## Payment submission security (Phase 6)

- **Strict Devnet Genesis Verification:** Before transactions are constructed or requested from Phantom, the customer client verifies the RPC cluster genesis hash against Devnet's canonical hash (`GH7ome3EiwEr7tu9JuPh2dpYWBJK3z69Xm1ZE3MEE6JC`). A mismatched network fails closed immediately.
- **Immutable Recipient Snapshots:** Merchant settlement wallet is snapshotted onto the quote at creation time (`merchantRecipient`). Changing the merchant settlement address does not redirect active quotes; payment transfers can only target the snapshotted recipient.
- **Platform Fee Safety:** When platform fees are nonzero, `PLATFORM_FEE_WALLET` must be configured and valid; quotes without a valid fee recipient fail closed. Zero-fee quotes include no fee instruction.
- **Exact Smallest-Unit Amounts:** All on-chain token calculations and instruction constructions use integer `bigint` token units (6 decimals for Devnet USDC). No JavaScript floating-point arithmetic is used for financial calculations.
- **Solana Pay Reference Uniqueness:** Each payment attempt generates a unique 32-byte Base58 reference pubkey. Attempts with duplicate references or quotes are rejected, preventing duplicate broadcasts or replay attacks.
- **Zero Custody & Non-Custodial Direct Transfers:** Transfers move tokens directly from customer ATA to merchant ATA (and fee ATA). Server never handles, signs, or routes transactions.
- **Submission as Hint, Never Settlement:** `PaymentAttempt` records status `PENDING` only. Neither client claims, wallet confirmation, nor signature broadcast mark a bill `PAID`. On-chain confirmation is reserved strictly for Phase 7's independent indexer.

## Independent indexer and verification security (Phase 7)

- **Zero-Trust Client Data:** The indexer never trusts client-submitted transaction signatures or amounts. Candidate signatures are discovered via Solana Pay reference indexing and verified on-chain at `finalized` commitment.
- **Fail-Closed Devnet Genesis Hash Check:** Worker startup validates RPC `getGenesisHash` against accepted Devnet hashes (`GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC` and `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`). Mismatched RPC clusters abort process execution immediately.
- **Full Instruction Decoding (No Balance Delta Inference):** The indexer decodes actual SPL token instructions (`Transfer` and `TransferChecked`) and verifies destination token account ownership against `quote.merchantRecipient` and `quote.feeRecipient`. It does not rely on simple token account balance changes which could be faked or combined.
- **Atomic Settlement and Replay Prevention:** Database transactions (`prisma.$transaction`) with unique constraints on `VerifiedTransaction.signature` prevent replay attacks and double-crediting. Duplicate transactions targeting an already-`PAID` bill are flagged as `OVERPAID / duplicate` without corrupting the bill status.
- **Worker Leases & Concurrency Safety:** The standalone worker uses a Redis distributed lease (`cryptopos:indexer:lease`) to ensure only a single worker instance indexes transactions at any time. Restart-safe checkpoints are tracked in PostgreSQL.
- **Exact Integer Arithmetic:** All amounts are parsed and compared as `bigint` token units (6 decimals for Devnet USDC). No floating point arithmetic is used for financial balances.

## Double-entry accounting ledger security (Phase 8)

- **Evidence-Only Posting:** Ledger postings are strictly restricted to finalized, independently verified on-chain payments (`VerifiedTransaction` with status `CONFIRMED`). Unconfirmed, failed, or raw wallet submissions can never create ledger entries.
- **Non-Custodial Accounting Model:** CryptoPOS remains non-custodial. Ledger entries represent immutable accounting evidence of direct transfers between customer and merchant wallets; they never imply platform custody of merchant funds.
- **Strict Integer Unit Preservation:** All token movements are tracked in exact integer smallest units (`BigInt`, 6 decimals for Devnet USDC). Fiat values use `Prisma.Decimal`. Zero floating-point arithmetic is permitted.
- **Strict Debit/Credit Balancing:** Every journal is verified inside an atomic transaction to ensure `totalDebitUnits === totalCreditUnits`. Unbalanced entries cannot be persisted. Assets and currencies are tracked per asset and never balanced against unlike currencies.
- **Append-Only Immutability:** Posted journals and entries are strictly immutable. No `UPDATE` or `DELETE` operations are supported. Adjustments and cancellations use linked `REVERSAL` journals.
- **Reversal Protection & Audit Trail:**
  - Reversals require merchant `OWNER` authorization (`MerchantOwnerGuard`). Cashiers receive 403 Forbidden.
  - Reversal requests mandate an audit reason and record the acting user ID.
  - An already-reversed journal cannot be reversed again (ConflictException).
  - A reversal journal cannot itself be reversed (ConflictException).
- **Platform Fee Separation:** Platform fee amounts (`feeUnits > 0`) post directly to platform-scoped accounts (`merchantId = null`) and platform fee revenue. Merchant sales revenue records only the merchant base amount (`amountUnits`), preventing revenue contamination.
- **Idempotency Under Concurrent Calls:** Idempotency keys (`settle_<sig>` and `reversal_<journalId>_<ts>`) along with unique database constraints `@@unique([verifiedTxId, type])` prevent duplicate settlement journals under concurrent worker executions or network retries.

## Analytics and Platform Admin Security (Phase 10)

- **Source of Truth Enforcement:** Financial metrics are derived strictly from finalized on-chain transactions (`VerifiedTransaction` with status `CONFIRMED`) and posted double-entry ledger entries. Unverified attempts, submitted signatures, and expired quotes are excluded from sales and revenue calculations.
- **Exact Decimal & Smallest-Unit Arithmetic:**
  - Token amounts use exact integer smallest units (`BigInt`, 6 decimals for Devnet USDC).
  - Fiat amounts use PostgreSQL exact decimals (`Prisma.Decimal`).
  - Zero JavaScript floating-point arithmetic is permitted for financial rollups.
- **Asset & Currency Segregation:** USDC token metrics, fiat currency amounts, and platform fees are tracked in separate fields and never aggregated into combined sums without explicit rate snapshots.
- **Strict Role-Based Platform Admin Protection:**
  - All `/admin/*` endpoints are protected by `JwtAuthGuard`, `RolesGuard`, and `@Roles(UserRole.PLATFORM_ADMIN)`.
  - Non-admin users (Cashiers and Owners) receive 403 Forbidden.
  - UI visibility alone is never trusted as security; all checks are enforced on every backend route.
- **Customer Privacy Protection:**
  - Platform admin views expose merchant business information, owner details, and settlement wallet addresses, but strictly exclude customer emails, passwords, and private keys.
- **Mandatory Admin Audit Logging:**
  - Administrative mutations (such as changing a merchant's status to `SUSPENDED` or `ACTIVE`) require a mandatory audit reason (minimum 5 characters).
  - Updates execute in a database transaction that creates an immutable `AdminAuditLog` record containing `actorId`, `actorEmail`, `targetId`, previous status, new status, reason, and timestamp.
- **Immediate Merchant Suspension Enforcement:**
  - When a merchant is marked `SUSPENDED`, `MerchantAccessGuard` immediately blocks all cashier and owner operations for that merchant with 403 Forbidden (`"Merchant account is suspended"`).
- **Date Range Boundary Validation:**
  - Analytics queries require `startDate <= endDate`.
  - Maximum allowable date range is capped at 365 days to prevent database denial-of-service and query timeouts.
- **Testnet Visual Disclaimers:**
  - Frontend analytics and admin views prominently display "Solana Devnet Testnet" badges to guarantee test tokens are never portrayed as real money.

- **Automated Discrepancy Detection:** The reconciliation engine checks for unposted confirmed payments, unbalanced journals, and verified-amount-to-journal mismatches without mutating existing data.

## Refund and adjustment security (Phase 9)

- **Strict Non-Custodial Merchant Signing:** The platform never custodies funds, stores merchant private keys, or signs transactions. All refund transactions must be signed by the merchant-controlled settlement wallet through Phantom or an approved client wallet flow.
- **Finalized Evidence Only:** Refunds can only be requested against finalized, independently verified incoming payments (`VerifiedTransaction` with status `CONFIRMED`). Unconfirmed, failed, or raw submitted payments are strictly non-refundable.
- **Strict Remaining-Balance Protection:** Total active refunds (`REQUESTED`, `APPROVED`, `PENDING`, `CONFIRMED`) cannot exceed the verified merchant base amount (`verifiedTx.amountUnits`). Concurrent attempts cannot create excess or duplicate refunds.
- **Platform Fee Non-Refundability Policy:** Platform fees are transferred directly from the customer to the platform fee wallet at payment time. Merchants cannot refund funds they never received. Any fee refund would require separate platform authorization; hence, merchant refunds are bounded strictly by the merchant base amount (`amountUnits`). This restriction is enforced server-side and clearly disclosed.
- **Payer Destination Enforcement:** By default, refunds are returned to the verified original payer wallet (`verifiedTx.sourceOwner`). Any destination override requires explicit owner review and is flagged with an audit indicator (`isDestinationOverridden`).
- **Owner-Only Approval & Signing:** Cashiers can request refunds, but only active merchant `OWNER`s can approve, reject, or submit refund signatures. Non-members receive 404 to prevent merchant enumeration.
- **Append-Only Ledger Settlement After Finality:** Original payment journals remain immutable. Linked double-entry refund adjustment journals (DEBIT `4100_MERCHANT_SALES`, CREDIT `1110_USDC_MERCHANT_SETTLEMENT`) are posted strictly after the on-chain refund transaction is independently verified at `finalized` commitment.
- **Full Audit Trail:** Every lifecycle transition (`REQUESTED`, `APPROVED`, `REJECTED`, `SUBMITTED`, `CONFIRMED`, `FAILED`) persists an immutable `RefundAuditLog` with actor ID, timestamp, and audit notes. History is never deleted.

## Development limitations

- The registration flow creates a merchant owner directly; local email verification and password reset are not implemented yet.
- New cashiers must already have a CryptoPOS account before an owner can add them. Invitation and verification email workflows remain future work.
- Audit logging, account-based abuse controls, password reset and email verification remain before an internet-facing deployment. Keep this phase on local development.
