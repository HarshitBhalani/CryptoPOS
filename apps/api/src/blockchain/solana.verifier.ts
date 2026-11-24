import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { VerificationStatus } from "@prisma/client";
import {
  DEVNET_USDC_MINT,
  DEVNET_USDC_DECIMALS,
  ACCEPTED_DEVNET_GENESIS_HASHES,
  OFFICIAL_DEVNET_GENESIS_HASH,
} from "./solana.constants";
import { decodeTransaction, DecodedTransactionSummary, DecodedSplTransfer } from "./solana.decoder";

export interface VerificationResult {
  isValid: boolean;
  status: VerificationStatus;
  reviewReason?: string;
  signature: string;
  slot: bigint;
  blockTime: Date | null;
  amountUnits: bigint;
  feeUnits: bigint;
  tokenMint: string;
  sourceOwner: string;
  destinationOwner: string;
  feeDestination?: string | null;
  reference: string;
  rawMeta: Record<string, unknown>;
}

export interface QuoteVerificationInput {
  id: string;
  tokenMint: string;
  tokenDecimals: number;
  cryptoUnits: bigint;
  feeUnits: bigint;
  merchantRecipient: string | null;
  feeRecipient: string | null;
  reference: string | null;
  expiresAt: Date;
}

/**
 * Verify that the RPC connection is connected to Solana Devnet.
 * Throws if genesis hash does not match acceptable Devnet hashes.
 */
export async function assertDevnetCluster(connection: Connection): Promise<string> {
  const genesisHash = await connection.getGenesisHash();
  if (!ACCEPTED_DEVNET_GENESIS_HASHES.has(genesisHash)) {
    throw new Error(
      `RPC genesis hash mismatch. Expected Solana Devnet (${OFFICIAL_DEVNET_GENESIS_HASH}), but received ${genesisHash}. Refusing to proceed.`
    );
  }
  return genesisHash;
}

/**
 * Perform independent on-chain verification of a Solana Devnet payment transaction against
 * an immutable Phase 6 quote snapshot.
 *
 * Rules enforced:
 * - Checks meta.err === null (successful execution).
 * - Checks Solana Pay reference presence in transaction account keys.
 * - Checks token mint is Devnet USDC with 6 decimals.
 * - Resolves destination ATA to merchant recipient wallet.
 * - Resolves fee ATA to platform fee wallet if fee applies.
 * - Checks exact bigint smallest units (no floats):
 *     exact match -> CONFIRMED
 *     underpaid   -> PARTIAL
 *     overpaid    -> OVERPAID
 * - Checks blockTime against quote expiration + late grace period:
 *     exceeded    -> LATE
 */
export function verifyPaymentTransaction(
  tx: any,
  quote: QuoteVerificationInput,
  options?: { lateGraceSeconds?: number }
): VerificationResult {
  const lateGraceSeconds = options?.lateGraceSeconds ?? 30;
  const decoded = decodeTransaction(tx);
  const signature = decoded.signature;
  const slot = decoded.slot;
  const blockTime = decoded.blockTime;

  // 1. Check for on-chain execution errors
  if (decoded.err !== null) {
    return {
      isValid: false,
      status: VerificationStatus.FAILED,
      reviewReason: `Transaction execution failed on-chain: ${JSON.stringify(decoded.err)}`,
      signature,
      slot,
      blockTime,
      amountUnits: 0n,
      feeUnits: 0n,
      tokenMint: quote.tokenMint,
      sourceOwner: decoded.payer,
      destinationOwner: quote.merchantRecipient ?? "",
      reference: quote.reference ?? "",
      rawMeta: { err: decoded.err, slot: Number(slot), blockTime },
    };
  }

  // 2. Validate Solana Pay reference is included in transaction account keys
  if (quote.reference && !decoded.allAccountKeys.includes(quote.reference)) {
    return {
      isValid: false,
      status: VerificationStatus.INVALID,
      reviewReason: `Solana Pay reference (${quote.reference}) not found in transaction account keys.`,
      signature,
      slot,
      blockTime,
      amountUnits: 0n,
      feeUnits: 0n,
      tokenMint: quote.tokenMint,
      sourceOwner: decoded.payer,
      destinationOwner: quote.merchantRecipient ?? "",
      reference: quote.reference ?? "",
      rawMeta: { missingReference: quote.reference, accountKeysCount: decoded.allAccountKeys.length },
    };
  }

  // 3. Validate merchant recipient is set on quote
  if (!quote.merchantRecipient) {
    return {
      isValid: false,
      status: VerificationStatus.INVALID,
      reviewReason: "Quote has no merchant recipient snapshot.",
      signature,
      slot,
      blockTime,
      amountUnits: 0n,
      feeUnits: 0n,
      tokenMint: quote.tokenMint,
      sourceOwner: decoded.payer,
      destinationOwner: "",
      reference: quote.reference ?? "",
      rawMeta: {},
    };
  }

  // Derive expected merchant ATA
  const mintKey = new PublicKey(DEVNET_USDC_MINT);
  const merchantKey = new PublicKey(quote.merchantRecipient);
  const expectedMerchantAta = getAssociatedTokenAddressSync(
    mintKey,
    merchantKey,
    true,
    new PublicKey(TOKEN_PROGRAM_ID),
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID)
  ).toBase58();

  // 4. Find the merchant transfer instruction
  const merchantTransfer = decoded.tokenTransfers.find((t) => {
    // Match either direct destination ATA or known owner of destination
    const ataMatches = t.destinationAta === expectedMerchantAta;
    const ownerMatches = t.destinationOwner && t.destinationOwner === quote.merchantRecipient;
    const mintMatches = !t.mint || t.mint === DEVNET_USDC_MINT;
    return (ataMatches || ownerMatches) && mintMatches;
  });

  if (!merchantTransfer) {
    return {
      isValid: false,
      status: VerificationStatus.INVALID,
      reviewReason: `No valid Devnet USDC transfer found to merchant recipient ATA (${expectedMerchantAta}).`,
      signature,
      slot,
      blockTime,
      amountUnits: 0n,
      feeUnits: 0n,
      tokenMint: quote.tokenMint,
      sourceOwner: decoded.payer,
      destinationOwner: quote.merchantRecipient,
      reference: quote.reference ?? "",
      rawMeta: { expectedMerchantAta, transfersCount: decoded.tokenTransfers.length },
    };
  }

  // Check decimals if checked transfer
  if (merchantTransfer.decimals !== undefined && merchantTransfer.decimals !== DEVNET_USDC_DECIMALS) {
    return {
      isValid: false,
      status: VerificationStatus.INVALID,
      reviewReason: `Token decimals mismatch: expected ${DEVNET_USDC_DECIMALS}, got ${merchantTransfer.decimals}.`,
      signature,
      slot,
      blockTime,
      amountUnits: merchantTransfer.amountUnits,
      feeUnits: 0n,
      tokenMint: quote.tokenMint,
      sourceOwner: merchantTransfer.sourceOwner || decoded.payer,
      destinationOwner: quote.merchantRecipient,
      reference: quote.reference ?? "",
      rawMeta: { transfer: merchantTransfer },
    };
  }

  // 5. Check platform fee transfer if applicable
  let feeUnitsTransferred = 0n;
  if (quote.feeUnits > 0n && quote.feeRecipient) {
    const feeKey = new PublicKey(quote.feeRecipient);
    const expectedFeeAta = getAssociatedTokenAddressSync(
      mintKey,
      feeKey,
      true,
      new PublicKey(TOKEN_PROGRAM_ID),
      new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID)
    ).toBase58();

    const feeTransfer = decoded.tokenTransfers.find((t) => {
      const ataMatches = t.destinationAta === expectedFeeAta;
      const ownerMatches = t.destinationOwner && t.destinationOwner === quote.feeRecipient;
      const mintMatches = !t.mint || t.mint === DEVNET_USDC_MINT;
      return (ataMatches || ownerMatches) && mintMatches;
    });

    if (!feeTransfer) {
      return {
        isValid: false,
        status: VerificationStatus.INVALID,
        reviewReason: `Platform fee transfer to ${quote.feeRecipient} was required (${quote.feeUnits} units) but not found.`,
        signature,
        slot,
        blockTime,
        amountUnits: merchantTransfer.amountUnits,
        feeUnits: 0n,
        tokenMint: quote.tokenMint,
        sourceOwner: merchantTransfer.sourceOwner || decoded.payer,
        destinationOwner: quote.merchantRecipient,
        feeDestination: quote.feeRecipient,
        reference: quote.reference ?? "",
        rawMeta: { expectedFeeAta, expectedFeeUnits: quote.feeUnits.toString() },
      };
    }
    feeUnitsTransferred = feeTransfer.amountUnits;
  }

  const transferredUnits = merchantTransfer.amountUnits;
  const sourceOwner = merchantTransfer.sourceOwner || decoded.payer;

  // 6. Check for partial or overpaid amounts
  let status: VerificationStatus;
  let reviewReason: string | undefined;

  if (transferredUnits < quote.cryptoUnits) {
    status = VerificationStatus.PARTIAL;
    reviewReason = `PARTIAL_PAYMENT: Received ${transferredUnits} units, but quote expected ${quote.cryptoUnits} units.`;
  } else if (transferredUnits > quote.cryptoUnits) {
    status = VerificationStatus.OVERPAID;
    reviewReason = `OVERPAYMENT: Received ${transferredUnits} units, but quote expected ${quote.cryptoUnits} units.`;
  } else {
    status = VerificationStatus.CONFIRMED;
  }

  // 7. Check for late payment (blockTime past quote.expiresAt + grace period)
  if (blockTime) {
    const expiresMs = quote.expiresAt.getTime();
    const graceMs = lateGraceSeconds * 1000;
    const blockTimeMs = blockTime.getTime();

    if (blockTimeMs > expiresMs + graceMs) {
      const lateSeconds = Math.round((blockTimeMs - expiresMs) / 1000);
      status = VerificationStatus.LATE;
      reviewReason = `LATE_PAYMENT: Transaction on-chain timestamp (${blockTime.toISOString()}) exceeded quote expiry (${quote.expiresAt.toISOString()}) by ${lateSeconds}s (grace: ${lateGraceSeconds}s).`;
    }
  }

  return {
    isValid: status === VerificationStatus.CONFIRMED,
    status,
    reviewReason,
    signature,
    slot,
    blockTime,
    amountUnits: transferredUnits,
    feeUnits: feeUnitsTransferred,
    tokenMint: DEVNET_USDC_MINT,
    sourceOwner,
    destinationOwner: quote.merchantRecipient,
    feeDestination: quote.feeRecipient,
    reference: quote.reference ?? "",
    rawMeta: {
      slot: Number(slot),
      blockTime,
      amountUnits: transferredUnits.toString(),
      feeUnits: feeUnitsTransferred.toString(),
      transfersCount: decoded.tokenTransfers.length,
      instructionIndex: merchantTransfer.instructionIndex,
    },
  };
}

export interface RefundVerificationInput {
  amountUnits: bigint;
  sourceWallet: string;
  destinationWallet: string;
  reference?: string | null;
  tokenMint?: string;
}

export interface RefundVerificationResult {
  isValid: boolean;
  signature: string;
  slot: bigint;
  blockTime: Date | null;
  transferredUnits: bigint;
  sourceOwner: string;
  destinationOwner: string;
  failureReason?: string;
  rawMeta: Record<string, unknown>;
}

/**
 * Perform independent on-chain verification of a Solana Devnet refund transaction.
 */
export function verifyRefundTransaction(
  tx: any,
  input: RefundVerificationInput
): RefundVerificationResult {
  const decoded = decodeTransaction(tx);
  const signature = decoded.signature;
  const slot = decoded.slot;
  const blockTime = decoded.blockTime;

  if (decoded.err !== null) {
    return {
      isValid: false,
      signature,
      slot,
      blockTime,
      transferredUnits: 0n,
      sourceOwner: decoded.payer,
      destinationOwner: input.destinationWallet,
      failureReason: `Transaction execution failed on-chain: ${JSON.stringify(decoded.err)}`,
      rawMeta: { err: decoded.err },
    };
  }

  // If reference was attached, verify it is in account keys
  if (input.reference && !decoded.allAccountKeys.includes(input.reference)) {
    return {
      isValid: false,
      signature,
      slot,
      blockTime,
      transferredUnits: 0n,
      sourceOwner: decoded.payer,
      destinationOwner: input.destinationWallet,
      failureReason: `Refund reference (${input.reference}) not found in transaction account keys.`,
      rawMeta: { accountKeysCount: decoded.allAccountKeys.length },
    };
  }

  // Derive expected destination ATA and source ATA
  const mintKey = new PublicKey(DEVNET_USDC_MINT);
  const destKey = new PublicKey(input.destinationWallet);
  const sourceKey = new PublicKey(input.sourceWallet);

  const expectedDestAta = getAssociatedTokenAddressSync(
    mintKey,
    destKey,
    true,
    new PublicKey(TOKEN_PROGRAM_ID),
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID)
  ).toBase58();

  const expectedSourceAta = getAssociatedTokenAddressSync(
    mintKey,
    sourceKey,
    true,
    new PublicKey(TOKEN_PROGRAM_ID),
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID)
  ).toBase58();

  // Find the refund transfer instruction
  const transfer = decoded.tokenTransfers.find((t) => {
    const destMatches = t.destinationAta === expectedDestAta || t.destinationOwner === input.destinationWallet;
    const srcMatches = t.sourceAta === expectedSourceAta || t.sourceOwner === input.sourceWallet || t.sourceOwner === decoded.payer;
    const mintMatches = !t.mint || t.mint === DEVNET_USDC_MINT;
    return destMatches && srcMatches && mintMatches;
  });

  if (!transfer) {
    return {
      isValid: false,
      signature,
      slot,
      blockTime,
      transferredUnits: 0n,
      sourceOwner: decoded.payer,
      destinationOwner: input.destinationWallet,
      failureReason: `No valid Devnet USDC transfer found to customer destination ATA (${expectedDestAta}).`,
      rawMeta: { expectedDestAta, expectedSourceAta, transfersCount: decoded.tokenTransfers.length },
    };
  }

  if (transfer.amountUnits !== input.amountUnits) {
    return {
      isValid: false,
      signature,
      slot,
      blockTime,
      transferredUnits: transfer.amountUnits,
      sourceOwner: transfer.sourceOwner || decoded.payer,
      destinationOwner: input.destinationWallet,
      failureReason: `Refund amount mismatch: expected ${input.amountUnits} units, received ${transfer.amountUnits} units.`,
      rawMeta: { transfer },
    };
  }

  return {
    isValid: true,
    signature,
    slot,
    blockTime,
    transferredUnits: transfer.amountUnits,
    sourceOwner: transfer.sourceOwner || decoded.payer,
    destinationOwner: input.destinationWallet,
    rawMeta: {
      slot: Number(slot),
      blockTime,
      amountUnits: transfer.amountUnits.toString(),
      transfersCount: decoded.tokenTransfers.length,
    },
  };
}
