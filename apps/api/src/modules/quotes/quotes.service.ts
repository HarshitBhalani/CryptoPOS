import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BillStatus, Prisma, QuoteStatus } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { PriceProvider } from "./price-provider";
import { DEVNET_NETWORK, DEVNET_USDC_MINT, DEVNET_USDC_DECIMALS, DEVNET_USDC_SYMBOL } from "../../blockchain/solana.constants";
import { isValidSolanaAddress } from "../../blockchain/solana.validator";

const SUPPORTED_FIAT = new Set(["USD", "AUD", "CAD", "EUR", "GBP", "INR"]);

@Injectable()
export class QuotesService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly prices: PriceProvider) {}

  async createPublic(paymentToken: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { publicToken: paymentToken },
      select: {
        id: true,
        merchantId: true,
        total: true,
        currency: true,
        status: true,
        merchant: { select: { settlementAddr: true } },
      },
    });
    if (!bill) throw new NotFoundException("Payment link not found");
    if (bill.status !== BillStatus.OPEN) throw new ConflictException("This bill is not open for payment");
    if (!SUPPORTED_FIAT.has(bill.currency)) throw new BadRequestException("This bill currency is not supported for crypto quotes");
    const configuredMint = this.config.get<string>("SOLANA_USDC_MINT", "").trim();
    if (configuredMint && configuredMint !== DEVNET_USDC_MINT) throw new ConflictException("Only the verified Solana Devnet USDC mint is enabled in this phase");

    // --- Phase 6: Snapshot recipients at quote creation ---
    const merchantRecipient = bill.merchant?.settlementAddr ?? null;
    if (!merchantRecipient || !isValidSolanaAddress(merchantRecipient)) {
      throw new ConflictException("Merchant has not configured a valid Solana Devnet settlement address. Payment cannot proceed.");
    }

    const snapshot = await this.prices.getUsdcRate(bill.currency);
    const feeBps = this.config.get<number>("PLATFORM_FEE_BPS", 0);
    const amountUnits = decimalRatioCeil(bill.total.toFixed(2), snapshot.rate, 6);
    const feeUnits = ceilDiv(amountUnits * BigInt(feeBps), 10_000n);
    const totalUnits = amountUnits + feeUnits;
    const ttlSeconds = this.config.get<number>("QUOTE_TTL_SECONDS", 120);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // Snapshot fee recipient only when feeUnits > 0
    let feeRecipient: string | null = null;
    if (feeUnits > 0n) {
      const platformFeeWallet = this.config.get<string>("PLATFORM_FEE_WALLET", "").trim();
      if (!platformFeeWallet || !isValidSolanaAddress(platformFeeWallet)) {
        throw new ConflictException("Platform fee is configured but no valid PLATFORM_FEE_WALLET address is set. Cannot create quote with fee.");
      }
      feeRecipient = platformFeeWallet;
    }

    const quote = await this.prisma.paymentQuote.create({ data: {
      billId: bill.id,
      merchantId: bill.merchantId,
      tokenMint: configuredMint || DEVNET_USDC_MINT,
      tokenSymbol: DEVNET_USDC_SYMBOL,
      tokenDecimals: DEVNET_USDC_DECIMALS,
      fiatAmount: bill.total,
      fiatCurrency: bill.currency,
      rate: new Prisma.Decimal(snapshot.rate),
      cryptoUnits: amountUnits,
      feeUnits,
      totalUnits,
      feeBps,
      priceSource: snapshot.source,
      priceUpdatedAt: snapshot.updatedAt,
      expiresAt,
      merchantRecipient,
      feeRecipient,
    } });
    return this.serialize(quote, { merchantSettlementAddress: merchantRecipient });
  }

  async listForMerchant(merchantId: string, billId: string) {
    const bill = await this.prisma.bill.findFirst({ where: { id: billId, merchantId }, select: { id: true } });
    if (!bill) throw new NotFoundException("Bill not found");
    const now = new Date();
    await this.prisma.paymentQuote.updateMany({ where: { billId, merchantId, status: QuoteStatus.ACTIVE, expiresAt: { lte: now } }, data: { status: QuoteStatus.EXPIRED } });
    const quotes = await this.prisma.paymentQuote.findMany({ where: { billId, merchantId }, orderBy: { createdAt: "desc" }, take: 50 });
    return { quotes: quotes.map((quote) => this.serialize(quote)), total: quotes.length };
  }

  private serialize(
    quote: { id: string; billId: string; tokenMint: string; tokenSymbol: string; tokenDecimals: number; fiatAmount: Prisma.Decimal; fiatCurrency: string; rate: Prisma.Decimal; cryptoUnits: bigint; feeUnits: bigint; totalUnits: bigint; feeBps: number; priceSource: string; priceUpdatedAt: Date; status: QuoteStatus; expiresAt: Date; createdAt: Date; merchantRecipient?: string | null; feeRecipient?: string | null; reference?: string | null },
    extra?: { merchantSettlementAddress?: string | null },
  ) {
    return {
      ...quote,
      network: DEVNET_NETWORK,
      merchantSettlementAddress: extra?.merchantSettlementAddress ?? quote.merchantRecipient ?? null,
      isSettlementConfigured: Boolean(extra?.merchantSettlementAddress ?? quote.merchantRecipient),
      merchantRecipient: quote.merchantRecipient ?? null,
      feeRecipient: quote.feeRecipient ?? null,
      fiatAmount: quote.fiatAmount.toFixed(2),
      rate: quote.rate.toString(),
      cryptoUnits: quote.cryptoUnits.toString(),
      feeUnits: quote.feeUnits.toString(),
      totalUnits: quote.totalUnits.toString(),
      cryptoAmount: formatUnits(quote.cryptoUnits, quote.tokenDecimals),
      feeAmount: formatUnits(quote.feeUnits, quote.tokenDecimals),
      totalCryptoAmount: formatUnits(quote.totalUnits, quote.tokenDecimals),
    };
  }
}

function decimalParts(value: string) {
  const [whole, fraction = ""] = value.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) throw new BadRequestException("Invalid decimal value for quote calculation");
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function decimalRatioCeil(numeratorDecimal: string, denominatorDecimal: string, unitDecimals: number): bigint {
  const numerator = decimalParts(numeratorDecimal);
  const denominator = decimalParts(denominatorDecimal);
  const top = numerator.coefficient * 10n ** BigInt(unitDecimals + denominator.scale);
  const bottom = denominator.coefficient * 10n ** BigInt(numerator.scale);
  if (bottom <= 0n) throw new BadRequestException("Price must be greater than zero");
  return ceilDiv(top, bottom);
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new BadRequestException("Invalid quote divisor");
  return (numerator + denominator - 1n) / denominator;
}

function formatUnits(units: bigint, decimals: number) {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fraction = (units % base).toString().padStart(decimals, "0");
  return decimals ? `${whole}.${fraction}` : whole.toString();
}
