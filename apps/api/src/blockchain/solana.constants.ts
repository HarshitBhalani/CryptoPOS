export const DEVNET_NETWORK = "devnet" as const;
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as const;
export const DEVNET_USDC_DECIMALS = 6 as const;
export const DEVNET_USDC_SYMBOL = "USDC" as const;

/** Specified Devnet genesis hash from architecture specification */
export const OFFICIAL_DEVNET_GENESIS_HASH = "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC" as const;
/** Canonical Solana Devnet cluster genesis hash */
export const CANONICAL_DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as const;

export const ACCEPTED_DEVNET_GENESIS_HASHES = new Set<string>([
  OFFICIAL_DEVNET_GENESIS_HASH,
  CANONICAL_DEVNET_GENESIS_HASH,
]);

export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as const;
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as const;

export const SUPPORTED_DEVNET_TOKEN = {
  symbol: DEVNET_USDC_SYMBOL,
  name: "USD Coin (Devnet)",
  mint: DEVNET_USDC_MINT,
  decimals: DEVNET_USDC_DECIMALS,
  network: DEVNET_NETWORK,
} as const;
