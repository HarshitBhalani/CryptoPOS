# Authentication flows

## Merchant registration

1. Merchant submits name, email, a 12–128 character password and business name.
2. API normalizes the email, hashes the password and creates the user, merchant and owner membership in one PostgreSQL transaction.
3. API creates a persisted refresh session and sets HTTP-only access and refresh cookies.
4. Frontend opens the protected dashboard and loads the account from `GET /api/v1/auth/me`.

## Login, refresh and logout

1. Login checks normalized email and bcrypt password hash, and rejects accounts with no active merchant membership.
2. API sets access (one hour) and refresh (30 days) HTTP-only cookies; tokens are never returned in JSON.
3. Frontend retries a 401 once after calling `POST /api/v1/auth/refresh`; refresh tokens rotate atomically.
4. Logout revokes the current refresh session and clears both cookies.

Registration is limited to five attempts per minute per client; login and refresh have separate limits. The current limiter uses process-local memory and must move to shared Redis storage before scaling horizontally.

## Staff foundation

An owner can list merchant members and add an existing CryptoPOS user by email as a cashier through `/api/v1/merchants/:merchantId/members`. The API verifies the owner membership, active merchant status and duplicate membership. Invitations for people without accounts are not implemented.

## POS and bill creation

1. Authenticated owner or cashier selects a business and enters currency, items, quantities, unit prices and optional tax/customer details.
2. API validates decimals and calculates each line, subtotal, tax and final total with Prisma Decimal; client totals are never accepted.
3. POS sends an idempotency key; the API binds that key to the normalized request so retries return the same bill and changed payloads are rejected.
4. API saves the OPEN bill and line items in PostgreSQL, creates a unique high-entropy public token and returns a link.
5. POS displays backend totals, a QR code and the payment link. Customer opens the public page and requests a time-limited USDC Devnet quote; the page shows the locked rate and fee and can request a fresh quote after expiry.
6. Staff can search/filter bills, open details, view quote history and cancel an OPEN bill. Cancellation atomically expires active quotes. Paid, pending, expired or otherwise non-open bills cannot be cancelled.

## Business and settlement wallet settings

The dashboard business selector scopes every merchant request. Owners can view and update the business name, type, and Solana Devnet settlement wallet at `/dashboard/settings`; the API checks owner membership and active merchant status. Cashiers cannot access or edit these settings (403 Forbidden).

Settlement wallet flow:
1. Owner enters a Solana Devnet address or clicks "Fill from Phantom" to connect their extension and auto-populate their public key.
2. Frontend runs instant client-side Base58 validation (32-byte check).
3. Backend validates that the address is a valid 32-byte Base58 Solana public key and confirms it is not registered to another merchant on Devnet.
4. Backend updates `Merchant.settlementAddr` and syncs the `Wallet` table (`purpose: "SETTLEMENT"`, `network: "devnet"`).
5. Owner can update or remove the settlement wallet at any time.

## Quote creation and customer wallet connection

1. Customer opens the public bill link (`/pay/[paymentToken]`).
2. Customer requests an exact 120-second USDC quote; backend snapshots rate, smallest-unit integer amounts, verified Devnet mint, fee, expiry, and immutably captures `merchantRecipient` (and `feeRecipient` if fee applies).
3. Customer connects their Phantom wallet via the browser window provider on Solana Devnet.
4. Connecting or disconnecting the wallet does NOT reset, cancel, or re-price the active quote snapshot; quote state and countdown timer remain completely intact.
5. Frontend displays connected customer public key, Solana Devnet network indicator with Developer Mode testnet guidance, and merchant settlement recipient address.

## Payment submission (Phase 6)

1. Pre-flight validations:
   - Bill is OPEN and quote is ACTIVE and unexpired.
   - Merchant recipient in quote snapshot is valid and matches merchant settlement wallet.
   - Connected RPC cluster is verified against Devnet's official genesis hash (`GH7ome3EiwEr7tu9JuPh2dpYWBJK3z69Xm1ZE3MEE6JC`).
2. Transaction construction:
   - Generates a unique 32-byte Base58 Solana Pay reference keypair pubkey.
   - Derives Associated Token Accounts (ATAs) for Devnet USDC mint (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) and recipients.
   - Appends idempotent ATA creation instructions.
   - Creates SPL token `TransferChecked` instructions with exact smallest-unit amounts.
   - Sets Solana Pay reference pubkey as non-signer account key for on-chain indexing.
3. Customer signs and submits via Phantom `signAndSendTransaction`.
4. Browser submits signature to `POST /public/pay/:paymentToken/submit`.
5. API validates quote, records `PaymentAttempt` with status `PENDING`, and updates `Bill.status` to `PENDING`.

## Independent verification and settlement (Phase 7)

1. Standalone indexer worker runs continuously or during API batch cycles.
2. Discovers candidate transactions by querying signatures for active quote references and submitted `PaymentAttempt` records.
3. Fetches transactions at `finalized` commitment from Solana Devnet RPC.
4. Independently decodes and verifies transaction:
   - Checks on-chain execution status (`err === null`).
   - Verifies presence of Solana Pay reference in account keys.
   - Verifies Circle Devnet USDC mint and 6 decimals.
   - Verifies merchant ATA destination and platform fee ATA destination.
   - Verifies exact smallest-unit token amounts against immutable quote snapshot.
   - Verifies blockTime against quote expiration + late grace period.
5. In an atomic transaction:
   - Updates `Bill.status` to `PAID` (or `PARTIALLY_PAID`, `OVERPAID`, `PAYMENT_REVIEW`).
   - Updates `PaymentAttempt.status` to `CONFIRMED` (or `FAILED`, `REVIEW_REQUIRED`).
   - Creates immutable `VerifiedTransaction` record.
6. Real-time customer UI polling detects confirmation and presents verified payment screen.

## Double-entry ledger posting and reconciliation (Phase 8)

1. When a transaction is confirmed by the indexer, the auto-posting hook calls `postPaymentSettlement`:
   - Auto-provisions Chart of Accounts for merchant (`1110_USDC_MERCHANT_SETTLEMENT` Asset, `4100_MERCHANT_SALES` Revenue) and platform (`1120_USDC_PLATFORM_FEE` Asset, `4200_PLATFORM_FEE_REVENUE` Revenue).
   - Generates balanced journal:
     - DEBIT `1110_USDC_MERCHANT_SETTLEMENT` (`amountUnits`)
     - CREDIT `4100_MERCHANT_SALES` (`amountUnits`)
     - DEBIT `1120_USDC_PLATFORM_FEE` (`feeUnits`, platform-scoped)
     - CREDIT `4200_PLATFORM_FEE_REVENUE` (`feeUnits`, platform-scoped)
   - Asserts `totalDebitUnits === totalCreditUnits`.
   - Links journal to `VerifiedTransaction` and `Bill` with unique idempotency key `settle_<sig>`.
2. Staff queries ledger:
   - `GET /merchants/:merchantId/ledger/journals` displays paginated journal entries and filters.
   - `GET /merchants/:merchantId/ledger/accounts` displays chart of accounts with aggregate debits, credits, and net balances.
   - `GET /merchants/:merchantId/ledger/reconciliation` detects any unposted confirmed payments, unbalanced journals, or amount discrepancies.
3. Journal reversal (owner-only):
   - Merchant owner calls `POST /merchants/:merchantId/ledger/journals/:journalId/reverse` with an audit reason.
   - Immutably generates an opposing `REVERSAL` journal flipping all debits and credits, linking `originalJournalId`.
   - Reversal guards prevent duplicate reversals or reversing reversal journals.

## Refund lifecycle and merchant signing (Phase 9)

1. **Refund Request**:
   - Authorized staff (Owner or Cashier) navigates to Bill Details (`/dashboard/bills/[billId]`).
   - Clicks "+ Request Refund".
   - Selects the confirmed payment transaction, enters exact amount up to the remaining refundable balance, reviews the destination address (defaulted to verified original payer), and inputs an audit reason.
   - Platform fee policy note clearly discloses that platform fees are non-refundable.
   - Submitting creates a `Refund` record in `REQUESTED` status with initial `RefundAuditLog`.
2. **Owner Review & Approval**:
   - An active merchant owner reviews the request.
   - If rejected, owner inputs a rejection reason; status moves to `REJECTED` and reserved balance is released.
   - If approved, owner clicks "Approve"; server transitions status to `APPROVED`, records `approvedById` and `approvedAt`, and generates a unique Solana Pay reference keypair.
3. **Wallet Signing via Phantom**:
   - Owner reviews signing details: Merchant source settlement address, Customer destination ATA, Exact USDC amount, Devnet cluster, and Circle Devnet USDC mint.
   - Clicks "Sign in Phantom".
   - Frontend verifies connected wallet matches merchant settlement wallet and Devnet cluster.
   - Builds SPL token `TransferChecked` instruction with idempotent ATA creation and refund reference key.
   - Owner signs and broadcasts transaction via Phantom extension.
   - Broadcast signature is submitted to `POST /merchants/:merchantId/refunds/:refundId/submit`.
   - Server transitions status to `PENDING` (never marks confirmed from client submission alone).
4. **Independent On-Chain Verification & Ledger Settlement**:
   - Standalone indexer or manual verification polls Devnet RPC at `finalized` commitment.
   - Verifies on-chain execution (`err === null`), mint, source ATA, destination ATA, amount, and reference.
   - In an atomic transaction:
     - Updates `Refund.status = CONFIRMED`, `confirmedAt`, `slot`, `blockTime`.
     - Appends `RefundAuditLog` entry.
     - Posts append-only double-entry ledger adjustment: DEBIT `4100_MERCHANT_SALES`, CREDIT `1110_USDC_MERCHANT_SETTLEMENT`.
     - Updates `Bill.status` to `PARTIALLY_REFUNDED` or `REFUNDED` (if all payments fully refunded).
   - Builds SPL `createTransferCheckedInstruction` for exact `cryptoUnits` to merchant ATA, and separate transfer for `feeUnits` to platform fee ATA if fee applies.
3. User approval & broadcast:
   - Displays clear confirmation card with merchant recipient address, amount, fee, and network.
   - Customer signs and broadcasts transaction via Phantom extension (`signAndSendTransaction`).
4. Backend submission recording:
   - Customer client posts `{ quoteId, reference, signature, customerWallet }` to `POST /api/v1/public/pay/:paymentToken/submit`.
   - API verifies quote is active, not expired, bill is open, reference/signature uniqueness, and persists a `PaymentAttempt` with status `PENDING`.
   - Never marks the bill `PAID` from wallet response or RPC submission; payment finality belongs to Phase 7's independent indexer.
   - Idempotent retries for the same quote return the existing `PaymentAttempt`.
5. Frontend displays submission status:
   - Shows transaction signature with Solana Explorer Devnet link.
   - Notifies customer that on-chain verification is pending.

## On-chain verification and settlement (Phase 7)

1. Independent indexer discovery:
   - Worker queries `getSignaturesForAddress` on active quote Solana Pay references and polls pending customer payment attempts.
   - Fetches on-chain transaction at `finalized` commitment using `maxSupportedTransactionVersion: 0`.
2. Cryptographic and business validation:
   - Verifies RPC cluster genesis hash against official Devnet hashes (`GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC` / `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`).
   - Verifies `meta.err === null` (transaction executed successfully).
   - Verifies Solana Pay reference is present in transaction account keys.
   - Verifies token mint is verified Devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`).
   - Verifies destination token account owner matches snapshotted `merchantRecipient`.
   - Verifies platform fee destination token account owner matches `feeRecipient` if applicable.
   - Compares exact integer amounts (`bigint` smallest units):
     - Exact match -> `CONFIRMED`.
     - Underpayment -> `PARTIAL` (bill status `PARTIALLY_PAID`).
     - Overpayment -> `OVERPAID` (bill status `OVERPAID`).
   - Checks on-chain `blockTime` against quote `expiresAt`:
     - If exceeded by more than `PAYMENT_LATE_GRACE_SECONDS` (30s), flags `LATE` (bill status `PAYMENT_REVIEW`).
3. Atomic settlement & state updates:
   - In a PostgreSQL transaction, persists verified transaction evidence in `VerifiedTransaction`.
   - Updates `PaymentAttempt.status` (`CONFIRMED`, `FAILED`, `REVIEW_REQUIRED`).
   - If exact and valid, updates `Bill.status` to `PAID`.
   - If duplicate transaction arrives for an already-`PAID` bill, leaves bill `PAID` and flags transaction as duplicate `OVERPAID`.
4. Real-time customer and merchant status:
   - Customer UI polls `/attempt/:quoteId` and transitions from pending to verified (`PAID`) or review.
   - Merchant views payment transaction history at `/merchants/:merchantId/bills/:billId/payments` and review queue at `/merchants/:merchantId/bills/review`.

## Merchant analytics and platform administration (Phase 10)

### Merchant analytics flow
1. Merchant owner or cashier navigates to `/dashboard/analytics`.
2. UI loads the audited financial source of truth via `GET /merchants/:merchantId/analytics/overview` and time series via `GET /merchants/:merchantId/analytics/series`.
3. User selects date presets ("Last 7 Days", "Last 30 Days", "Last 90 Days") or custom start/end boundaries.
4. Dashboard displays:
   - Prominent "Solana Devnet Testnet" disclaimer badge.
   - Exact crypto KPI cards: Net Sales, Gross Sales, Confirmed Refunds, Platform Fees Paid, Average Payment per transaction.
   - Proportional fiat equivalents (`USD`).
   - Double-entry ledger audit status indicator verifying that debits equal credits across all posted journals.
   - Daily breakdown timeline showing transactions, refunds, net amounts, and fee allocations in chronological sequence.
   - Bill status distribution for the selected date window.

### Platform administration flow
1. Platform admin logs in with an account having global role `PLATFORM_ADMIN`.
2. Admin accesses `/admin` (non-admin users are blocked with 403 Forbidden).
3. Admin oversees platform health:
   - Total active and suspended merchants.
   - Platform-wide net and gross USDC volume.
   - Total platform fees collected.
   - Solana Devnet indexer background worker checkpoint and last indexed slot.
   - Double-entry accounting health.
4. Merchant Directory management:
   - Admin searches and filters merchants by name, settlement address, or status.
   - Admin views merchant details at `/admin/merchants/:merchantId` including team members, wallet addresses, and volume metrics.
   - Admin clicks "Suspend" or "Activate" to mutate merchant status.
   - Confirmation modal prompts for mandatory audit reason (minimum 5 characters).
   - Backend writes an immutable `AdminAuditLog` record and updates status.
   - If suspended, `MerchantAccessGuard` blocks all cashier and owner operations for that merchant immediately.
5. System-wide ledger reconciliation:
   - Admin reviews `/admin/ledger/reconciliation` to verify that every posted journal in the system maintains exact integer debit-credit balance.
   - Displays total system debits, credits, and zero imbalanced journals.
6. Audit trail inspection:
   - Admin views `/admin/audit-logs` to inspect all historical administrative actions, actor emails, timestamps, and reason statements.
