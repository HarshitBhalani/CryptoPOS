import { BadRequestException } from "@nestjs/common";
import bs58 from "bs58";

// Handle commonjs / esm differences for bs58
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

export function assertValidSolanaAddress(address: unknown, fieldName = "Address"): asserts address is string {
  if (!isValidSolanaAddress(address)) {
    throw new BadRequestException(`${fieldName} must be a valid 32-byte Solana public key in base58 format`);
  }
}
