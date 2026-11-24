import bs58 from "bs58";

export const DEVNET_NETWORK = "devnet" as const;
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as const;
export const DEVNET_USDC_DECIMALS = 6 as const;
export const DEVNET_USDC_SYMBOL = "USDC" as const;

export const SUPPORTED_DEVNET_TOKEN = {
  symbol: DEVNET_USDC_SYMBOL,
  name: "USD Coin (Devnet)",
  mint: DEVNET_USDC_MINT,
  decimals: DEVNET_USDC_DECIMALS,
  network: DEVNET_NETWORK,
} as const;

const codec = (bs58 as unknown as { default?: typeof bs58 }).default || bs58;

export function isValidSolanaAddress(address: unknown): address is string {
  if (typeof address !== "string") return false;
  const trimmed = address.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  try {
    const decoded = codec.decode(trimmed);
    if (decoded.length !== 32) return false;
    return codec.encode(decoded) === trimmed;
  } catch {
    return false;
  }
}

export function shortenAddress(address: string, chars = 4): string {
  if (!address) return "";
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export interface PhantomPublicKey {
  toString(): string;
  toBase58(): string;
  toBytes(): Uint8Array;
}

export interface PhantomProvider {
  isPhantom?: boolean;
  publicKey: PhantomPublicKey | null;
  isConnected: boolean;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PhantomPublicKey }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(transaction: unknown, options?: { skipPreflight?: boolean }): Promise<{ signature: string }>;
  on(event: "connect", handler: (publicKey: PhantomPublicKey) => void): void;
  on(event: "disconnect", handler: () => void): void;
  on(event: "accountChanged", handler: (publicKey: PhantomPublicKey | null) => void): void;
  removeListener(event: string, handler: unknown): void;
}

declare global {
  interface Window {
    phantom?: {
      solana?: PhantomProvider;
    };
    solana?: PhantomProvider;
  }
}

export function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  if ("phantom" in window && window.phantom?.solana?.isPhantom) {
    return window.phantom.solana;
  }
  if ("solana" in window && window.solana?.isPhantom) {
    return window.solana;
  }
  return null;
}
