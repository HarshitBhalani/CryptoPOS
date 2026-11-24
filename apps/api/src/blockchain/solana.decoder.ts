import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  DEVNET_USDC_MINT,
  DEVNET_USDC_DECIMALS,
} from "./solana.constants";

export interface DecodedSplTransfer {
  instructionIndex: number;
  isInner: boolean;
  programId: string;
  type: "Transfer" | "TransferChecked";
  sourceAta: string;
  destinationAta: string;
  destinationOwner?: string;
  sourceOwner?: string;
  mint?: string;
  amountUnits: bigint;
  decimals?: number;
}

export interface DecodedTransactionSummary {
  signature: string;
  slot: bigint;
  blockTime: Date | null;
  err: unknown | null;
  allAccountKeys: string[];
  payer: string;
  tokenTransfers: DecodedSplTransfer[];
  postTokenBalances: Array<{
    accountIndex: number;
    accountPubkey: string;
    mint: string;
    owner: string;
    amount: bigint;
  }>;
}

/**
 * Decode u64 little-endian integer from Uint8Array / Buffer / number[].
 */
function readBigUInt64LE(data: Uint8Array, offset: number): bigint {
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result |= BigInt(data[offset + i]) << BigInt(i * 8);
  }
  return result;
}

/**
 * Decode a Solana transaction response (legacy or v0 versioned) into a structured summary
 * containing all SPL token transfer instructions, destination owners, and account keys.
 */
export function decodeTransaction(tx: any): DecodedTransactionSummary {
  if (!tx || !tx.transaction) {
    throw new Error("Invalid transaction object: missing transaction payload");
  }

  const signature =
    typeof tx.transaction.signatures?.[0] === "string"
      ? tx.transaction.signatures[0]
      : tx.transaction.signatures?.[0]?.toString?.() ?? "";

  const slot = BigInt(tx.slot ?? 0);
  const blockTime = tx.blockTime ? new Date(tx.blockTime * 1000) : null;
  const err = tx.meta?.err ?? null;

  // 1. Resolve all account keys (handling v0 loaded lookup tables)
  const message = tx.transaction.message;
  let allKeys: PublicKey[] = [];

  if (message.getAccountKeys) {
    // Versioned message
    const loaded = tx.meta?.loadedAddresses;
    const accountKeys = message.getAccountKeys({
      accountKeysFromLookups: loaded
        ? {
            writable: loaded.writable?.map((k: any) => new PublicKey(k)) ?? [],
            readonly: loaded.readonly?.map((k: any) => new PublicKey(k)) ?? [],
          }
        : undefined,
    });
    allKeys = accountKeys.keySegments().flat();
  } else if (Array.isArray(message.accountKeys)) {
    // Legacy message or raw array
    allKeys = message.accountKeys.map((k: any) =>
      k instanceof PublicKey ? k : new PublicKey(k)
    );
    if (tx.meta?.loadedAddresses) {
      if (Array.isArray(tx.meta.loadedAddresses.writable)) {
        allKeys.push(
          ...tx.meta.loadedAddresses.writable.map(
            (k: any) => (k instanceof PublicKey ? k : new PublicKey(k))
          )
        );
      }
      if (Array.isArray(tx.meta.loadedAddresses.readonly)) {
        allKeys.push(
          ...tx.meta.loadedAddresses.readonly.map(
            (k: any) => (k instanceof PublicKey ? k : new PublicKey(k))
          )
        );
      }
    }
  }

  const allAccountKeys = allKeys.map((k) => k.toBase58());
  const payer = allAccountKeys[0] ?? "";

  // 2. Parse postTokenBalances to map ATA -> owner and mint
  const postTokenBalances: DecodedTransactionSummary["postTokenBalances"] = [];
  const ataToOwnerMap = new Map<string, { owner: string; mint: string }>();

  if (Array.isArray(tx.meta?.postTokenBalances)) {
    for (const b of tx.meta.postTokenBalances) {
      const pubkey = allAccountKeys[b.accountIndex] ?? "";
      const rawAmount = b.uiTokenAmount?.amount ?? "0";
      const item = {
        accountIndex: b.accountIndex,
        accountPubkey: pubkey,
        mint: b.mint ?? "",
        owner: b.owner ?? "",
        amount: BigInt(rawAmount),
      };
      postTokenBalances.push(item);
      if (pubkey && b.owner) {
        ataToOwnerMap.set(pubkey, { owner: b.owner, mint: b.mint });
      }
    }
  }

  // Also check preTokenBalances for any ATA owner mappings
  if (Array.isArray(tx.meta?.preTokenBalances)) {
    for (const b of tx.meta.preTokenBalances) {
      const pubkey = allAccountKeys[b.accountIndex] ?? "";
      if (pubkey && b.owner && !ataToOwnerMap.has(pubkey)) {
        ataToOwnerMap.set(pubkey, { owner: b.owner, mint: b.mint });
      }
    }
  }

  // 3. Helper to decode an instruction if it belongs to SPL Token Program
  const tokenTransfers: DecodedSplTransfer[] = [];

  function processInstruction(
    ix: { programIdIndex?: number; accountKeyIndexes?: number[]; accounts?: number[]; data: any },
    index: number,
    isInner: boolean
  ) {
    const programIdIdx = ix.programIdIndex;
    if (programIdIdx === undefined) return;
    const programId = allAccountKeys[programIdIdx];
    if (programId !== TOKEN_PROGRAM_ID) return;

    const accountIndices = ix.accountKeyIndexes ?? ix.accounts ?? [];

    // Decode data from Base58 or Buffer/Uint8Array
    let rawData: Uint8Array;
    if (typeof ix.data === "string") {
      const bs58 = (require("bs58").default || require("bs58"));
      try {
        rawData = bs58.decode(ix.data);
      } catch {
        return;
      }
    } else if (ix.data instanceof Uint8Array || Buffer.isBuffer(ix.data)) {
      rawData = new Uint8Array(ix.data);
    } else if (Array.isArray(ix.data)) {
      rawData = new Uint8Array(ix.data);
    } else {
      return;
    }

    if (rawData.length < 9) return;
    const opcode = rawData[0];

    // Opcode 3: Transfer (amount: u64 LE at offset 1)
    // Accounts: [0: source, 1: destination, 2: authority]
    if (opcode === 3 && rawData.length >= 9 && accountIndices.length >= 2) {
      const amountUnits = readBigUInt64LE(rawData, 1);
      const sourceAta = allAccountKeys[accountIndices[0]] ?? "";
      const destinationAta = allAccountKeys[accountIndices[1]] ?? "";
      const destMeta = ataToOwnerMap.get(destinationAta);
      const srcMeta = ataToOwnerMap.get(sourceAta);

      tokenTransfers.push({
        instructionIndex: index,
        isInner,
        programId,
        type: "Transfer",
        sourceAta,
        destinationAta,
        destinationOwner: destMeta?.owner,
        sourceOwner: srcMeta?.owner,
        mint: destMeta?.mint || srcMeta?.mint,
        amountUnits,
      });
    }

    // Opcode 12: TransferChecked (amount: u64 LE at offset 1, decimals: u8 at offset 9)
    // Accounts: [0: source, 1: mint, 2: destination, 3: authority]
    if (opcode === 12 && rawData.length >= 10 && accountIndices.length >= 3) {
      const amountUnits = readBigUInt64LE(rawData, 1);
      const decimals = rawData[9];
      const sourceAta = allAccountKeys[accountIndices[0]] ?? "";
      const mint = allAccountKeys[accountIndices[1]] ?? "";
      const destinationAta = allAccountKeys[accountIndices[2]] ?? "";
      const destMeta = ataToOwnerMap.get(destinationAta);
      const srcMeta = ataToOwnerMap.get(sourceAta);

      tokenTransfers.push({
        instructionIndex: index,
        isInner,
        programId,
        type: "TransferChecked",
        sourceAta,
        destinationAta,
        destinationOwner: destMeta?.owner,
        sourceOwner: srcMeta?.owner,
        mint: mint || destMeta?.mint || srcMeta?.mint,
        amountUnits,
        decimals,
      });
    }
  }

  // 4. Process outer instructions
  const instructions = message.compiledInstructions ?? message.instructions ?? [];
  instructions.forEach((ix: any, idx: number) => {
    processInstruction(ix, idx, false);
  });

  // 5. Process inner instructions (if any)
  if (Array.isArray(tx.meta?.innerInstructions)) {
    for (const inner of tx.meta.innerInstructions) {
      if (Array.isArray(inner.instructions)) {
        inner.instructions.forEach((ix: any, idx: number) => {
          processInstruction(ix, idx, true);
        });
      }
    }
  }

  return {
    signature,
    slot,
    blockTime,
    err,
    allAccountKeys,
    payer,
    tokenTransfers,
    postTokenBalances,
  };
}
