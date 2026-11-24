/**
 * payment.ts â€” Phase 6 Solana USDC payment utilities
 *
 * Uses @solana/web3.js v1.x (1.99.x) and @solana/spl-token.
 * All amounts are BigInt in smallest token units (6 decimals for USDC).
 * No floating point arithmetic for financial values.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { DEVNET_USDC_MINT, DEVNET_USDC_DECIMALS } from "./solana";

export const DEVNET_GENESIS_HASH =
  "GH7ome3EiwEr7tu9JuPh2dpYWBJK3z69Xm1ZE3MEE6JC";

export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

/**
 * Verify that the connected RPC endpoint is on Solana Devnet by checking
 * the cluster genesis hash. Throws if it doesn't match.
 */
export async function verifyDevnetCluster(rpcUrl: string): Promise<void> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }),
  });
  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status} ${response.statusText}`);
  }
  const json = (await response.json()) as { result?: string; error?: { message: string } };
  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`);
  }
  if (json.result !== DEVNET_GENESIS_HASH) {
    throw new Error(
      `Connected RPC is not Solana Devnet. Got genesis hash: ${json.result ?? "unknown"}. ` +
        "Please ensure Phantom is set to Devnet in Settings â†’ Developer Settings â†’ Testnet Mode."
    );
  }
}

export interface PaymentParams {
  /** Customer's wallet public key (base58) */
  customerWallet: string;
  /** Merchant settlement address (base58) â€” from immutable quote snapshot */
  merchantRecipient: string;
  /** Platform fee recipient (base58) â€” from immutable quote snapshot; null if no fee */
  feeRecipient: string | null;
  /** USDC amount to merchant in smallest units (6 decimals) */
  cryptoUnits: bigint;
  /** Platform fee in smallest units (6 decimals); BigInt(0) if no fee */
  feeUnits: bigint;
  /** Solana Pay reference pubkey (base58) â€” unique per payment attempt */
  reference: string;
  /** RPC URL to use */
  rpcUrl?: string;
}

export interface BuiltTransaction {
  transaction: Transaction;
  connection: Connection;
}

/**
 * Build an unsigned USDC transfer transaction.
 *
 * Creates:
 * - Idempotent ATA creation for merchant recipient (and fee recipient if applicable)
 * - createTransferChecked for cryptoUnits â†’ merchant ATA
 * - createTransferChecked for feeUnits â†’ fee ATA (only when feeUnits > 0)
 *
 * Uses exact bigint amounts â€” no floating point.
 */
export async function buildUsdcPaymentTransaction(
  params: PaymentParams
): Promise<BuiltTransaction> {
  const rpcUrl = params.rpcUrl ?? SOLANA_RPC_URL;

  // Verify genesis hash first
  await verifyDevnetCluster(rpcUrl);

  const connection = new Connection(rpcUrl, "confirmed");
  const mint = new PublicKey(DEVNET_USDC_MINT);
  const payer = new PublicKey(params.customerWallet);
  const merchantKey = new PublicKey(params.merchantRecipient);

  // Derive associated token accounts
  const payerAta = getAssociatedTokenAddressSync(mint, payer, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const merchantAta = getAssociatedTokenAddressSync(mint, merchantKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: payer,
  });

  // Idempotent ATA creation for merchant â€” safe if already exists
  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer,
      merchantAta,
      merchantKey,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );

  // Transfer USDC to merchant using checked transfer (validates mint and decimals)
  transaction.add(
    createTransferCheckedInstruction(
      payerAta,
      mint,
      merchantAta,
      payer,
      params.cryptoUnits,
      DEVNET_USDC_DECIMALS,
      [],
      TOKEN_PROGRAM_ID
    )
  );

  // Fee transfer if applicable
  if (params.feeUnits > BigInt(0) && params.feeRecipient) {
    const feeKey = new PublicKey(params.feeRecipient);
    const feeAta = getAssociatedTokenAddressSync(mint, feeKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer,
        feeAta,
        feeKey,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    transaction.add(
      createTransferCheckedInstruction(
        payerAta,
        mint,
        feeAta,
        payer,
        params.feeUnits,
        DEVNET_USDC_DECIMALS,
        [],
        TOKEN_PROGRAM_ID
      )
    );
  }

  return { transaction, connection };
}

/**
 * Generate a random Solana Pay reference keypair pubkey (base58).
 * Used as a unique idempotency key for a payment attempt.
 */
export function generateReference(): string {
  const { Keypair } = require("@solana/web3.js") as typeof import("@solana/web3.js");
  return Keypair.generate().publicKey.toBase58();
}

export type PaymentStep =
  | "idle"
  | "preparing"
  | "approving"
  | "submitting"
  | "pending"
  | "confirmed"
  | "review"
  | "failed"
  | "rejected";

export interface PaymentResult {
  signature: string;
  reference: string;
  attemptId: string;
  status: "PENDING";
}

export interface RefundSigningParams {
  merchantWallet: string;
  destinationWallet: string;
  amountUnits: bigint;
  reference: string;
  rpcUrl?: string;
}

/**
 * Build an unsigned USDC refund transaction from merchant wallet to customer destination.
 */
export async function buildUsdcRefundTransaction(
  params: RefundSigningParams
): Promise<BuiltTransaction> {
  const rpcUrl = params.rpcUrl ?? SOLANA_RPC_URL;
  await verifyDevnetCluster(rpcUrl);

  const connection = new Connection(rpcUrl, "confirmed");
  const mint = new PublicKey(DEVNET_USDC_MINT);
  const merchantKey = new PublicKey(params.merchantWallet);
  const customerKey = new PublicKey(params.destinationWallet);
  const referenceKey = new PublicKey(params.reference);

  const sourceAta = getAssociatedTokenAddressSync(
    mint,
    merchantKey,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const destinationAta = getAssociatedTokenAddressSync(
    mint,
    customerKey,
    true,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: merchantKey,
  });

  // Idempotent ATA creation for destination
  transaction.add(
    createAssociatedTokenAccountIdempotentInstruction(
      merchantKey,
      destinationAta,
      customerKey,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  );

  // TransferChecked instruction
  const transferIx = createTransferCheckedInstruction(
    sourceAta,
    mint,
    destinationAta,
    merchantKey,
    params.amountUnits,
    DEVNET_USDC_DECIMALS,
    [],
    TOKEN_PROGRAM_ID
  );

  // Append Solana Pay reference as non-signer, read-only key for indexing
  transferIx.keys.push({
    pubkey: referenceKey,
    isSigner: false,
    isWritable: false,
  });

  transaction.add(transferIx);

  return { transaction, connection };
}
