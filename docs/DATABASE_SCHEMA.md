# Database schema

PostgreSQL schema managed with Prisma. Financial values use `Decimal`, and Solana smallest-unit amounts use `BigInt`.

## Current entities

- `User`: unique normalized email, bcrypt hash, global role and timestamps.
- `Merchant`: business profile, active/suspended state, optional settlement address.
- `MerchantMember`: unique `(userId, merchantId)` membership and owner/cashier role.
- `RefreshToken`: unique SHA-256 refresh-token hash, expiry/revocation and replacement hash; cascades with its user.
- `Wallet`: merchant-owned network/address and purpose; network/address unique.
- `Bill`: merchant, unique bill number, high-entropy public token, optional customer details, fiat currency, exact subtotal/tax/total, explicit bill status, idempotency key and normalized request hash.
- `BillItem`: bill line description, decimal quantity/unit price, calculated line total.
- `PaymentQuote`: immutable bill+merchant quote snapshot: fiat amount/currency, USDC mint/symbol/decimals, rate and source timestamp, base/fee/total smallest units, fee basis points, status and expiry. Phase 6 snapshots: `merchantRecipient` (merchant settlement address at quote creation), `feeRecipient` (platform fee address if fee applies), and optional unique `reference` (Solana Pay reference pubkey).
- `PaymentAttempt`: customer payment submission attempt linking `quoteId` (unique), `billId`, `merchantId`, `customerWallet`, `reference` (unique), `signature` (unique), and `status` (`PENDING`, `CONFIRMED`, `FAILED`, `REVIEW_REQUIRED`).
- `VerifiedTransaction`: verified on-chain payment evidence containing `signature` (unique), `slot`, `blockTime`, `amountUnits`, `feeUnits`, `tokenMint`, `sourceOwner`, `destinationOwner`, `feeDestination`, `reference`, `status` (`CONFIRMED`, `FAILED`, `PARTIAL`, `OVERPAID`, `LATE`, `INVALID`), `reviewReason`, and raw minimal JSON metadata.
- `IndexerCheckpoint`: restart-safe indexing state key, tracking `lastSlot`, `lastSig`, and cursor metadata.
- `LedgerAccount`: double-entry chart of accounts entity with `code`, `name`, `type` (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`), `currency` (`USDC`), `network` (`devnet`), and optional `merchantId` (null for platform-scoped accounts). Unique on `[merchantId, code, currency]`.
- `LedgerJournal`: immutable double-entry journal header with `merchantId`, `billId`, `verifiedTxId`, `type` (`PAYMENT_SETTLEMENT`, `REVERSAL`, `ADJUSTMENT`), `idempotencyKey` (unique), `totalDebitUnits` (`BigInt`), `totalCreditUnits` (`BigInt`), `fiatAmount`, `originalJournalId` (for reversals), `reversalReason`, and `postedAt`. Unique on `[verifiedTxId, type]`.
- `LedgerEntry`: individual balanced journal entry with `journalId`, `accountId`, `direction` (`DEBIT`, `CREDIT`), `amountUnits` (`BigInt`), and `entryOrder`. Each journal enforces `sum(DEBIT) === sum(CREDIT)`.
- `Refund`: refund lifecycle entity tracking full and partial refunds against confirmed verified payments. Holds `amountUnits` (`BigInt`), `currency`, `fiatAmount`, `destinationWallet` (base58, defaults to payer `verifiedTx.sourceOwner`), `isDestinationOverridden`, `sourceWallet` (merchant settlement address), `reason`, `status` (`REQUESTED`, `APPROVED`, `REJECTED`, `PENDING`, `CONFIRMED`, `FAILED`), unique `idempotencyKey`, `requestedById`, `approvedById`, `rejectedById`, unique `signature`, unique `reference` (Solana Pay reference for on-chain indexing), and `ledgerJournalId`.
- `RefundAuditLog`: immutable history tracking every action (`REQUESTED`, `APPROVED`, `REJECTED`, `SUBMITTED`, `CONFIRMED`, `FAILED`), from/to status transitions, actor IDs, timestamps, and audit notes.
- `AdminAuditLog`: immutable audit trail tracking platform administrative operations and merchant mutations with `actorId`, `actorEmail`, `action` (`UPDATE_MERCHANT_STATUS`), `targetType` (`MERCHANT`), `targetId`, `details` (JSON payload with previous status, new status, and audit reason), and `createdAt`.

`Bill` has a unique `(merchantId, idempotencyKey)` index. Nullable keys permit legacy rows; newly created bills require a valid key. Bill items cascade with their bill; merchant deletion is restricted while bills exist. The Phase 3 migration preserves legacy bill rows, deriving old subtotal from the existing total and setting legacy tax to zero. The Phase 4 migration backfills quote merchant/currency/timestamp references from existing bills. The Phase 6 migration (`20261124232634_phase6_payments`) introduces `merchantRecipient`, `feeRecipient`, and `reference` on `PaymentQuote`, and creates the `PaymentAttempt` table and relations. The Phase 7 migration (`20261124234230_phase7_indexer`) introduces `VerifiedTransaction`, `IndexerCheckpoint`, `VerificationStatus` enum, and extends `PaymentAttemptStatus` with `CONFIRMED` and `REVIEW_REQUIRED`. The Phase 8 migration (`20261125000340_phase8_ledger`) introduces `LedgerAccount`, `LedgerJournal`, `LedgerEntry`, and related enums (`LedgerAccountType`, `LedgerEntryDirection`, `JournalType`). The Phase 9 migration (`20261125002000_phase9_refunds`) introduces `Refund`, `RefundAuditLog`, `RefundStatus` enum, extends `BillStatus` with `PARTIALLY_REFUNDED` and `REFUNDED`, and replaces the unique constraint on `[verifiedTxId, type]` with a multi-column index to support multiple partial refund adjustments. The Phase 10 migration (`20261125003500_phase10_admin_audit`) introduces `AdminAuditLog` with actor and target indexing.

## Planned later entities

Platform deployment configurations and staging environments are managed in Phase 11.
