import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { RedisService } from "../redis.service";

export type PriceSnapshot = { rate: string; updatedAt: Date; source: "coingecko" };

@Injectable()
export class PriceProvider {
  constructor(private readonly config: ConfigService, private readonly redis: RedisService) {}

  async getUsdcRate(currency: string): Promise<PriceSnapshot> {
    const cacheKey = `cryptopos:price:usd-coin:${currency.toLowerCase()}`;
    try {
      const cached = await this.redis.client.get(cacheKey);
      if (cached) {
        const item = JSON.parse(cached) as { rate?: unknown; updatedAt?: unknown };
        const updatedAt = new Date(String(item.updatedAt));
        if (typeof item.rate === "string" && /^\d+(?:\.\d+)?$/.test(item.rate) && Number.isFinite(updatedAt.getTime()) && this.isFresh(updatedAt)) {
          return { rate: item.rate, updatedAt, source: "coingecko" };
        }
      }
    } catch { /* Redis cache miss/failure falls through to the provider. */ }

    const apiKey = this.config.get<string>("PRICE_PROVIDER_API_KEY", "").trim();
    if (!apiKey) throw new ServiceUnavailableException("Price provider is not configured. Add a CoinGecko Demo API key as PRICE_PROVIDER_API_KEY.");
    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    url.searchParams.set("ids", "usd-coin");
    url.searchParams.set("vs_currencies", currency.toLowerCase());
    url.searchParams.set("include_last_updated_at", "true");
    let body: string;
    try {
      const response = await fetch(url, { headers: { "x-cg-demo-api-key": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
      body = await response.text();
    } catch {
      throw new ServiceUnavailableException("Live USDC price is temporarily unavailable. Try again shortly.");
    }

    const coin = body.match(/"usd-coin"\s*:\s*\{([^}]*)\}/i)?.[1];
    const escapedCurrency = currency.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rawRate = coin?.match(new RegExp(`"${escapedCurrency}"\\s*:\\s*(\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`, "i"))?.[1];
    const rawTimestamp = coin?.match(/"last_updated_at"\s*:\s*(\d+)/i)?.[1];
    if (!rawRate || !rawTimestamp || !Number.isSafeInteger(Number(rawTimestamp))) {
      throw new ServiceUnavailableException("Price provider returned an invalid USDC price.");
    }
    let decimalRate: Prisma.Decimal;
    try {
      decimalRate = new Prisma.Decimal(rawRate);
    } catch {
      throw new ServiceUnavailableException("Price provider returned an invalid USDC price.");
    }
    const updatedAt = new Date(Number(rawTimestamp) * 1000);
    if (decimalRate.isNaN() || !decimalRate.isFinite() || decimalRate.lte(0) || !this.isFresh(updatedAt)) {
      throw new ServiceUnavailableException("Price provider returned a stale or invalid USDC price. Try again shortly.");
    }
    const normalizedRate = this.normalizeRate(rawRate);
    const [wholePart, fractionalPart = ""] = normalizedRate.split(".");
    if (wholePart.length > 18 || fractionalPart.length > 12) throw new ServiceUnavailableException("Price precision is outside the supported database range.");
    const ttl = this.config.get<number>("PRICE_CACHE_TTL_SECONDS", 15);
    try { await this.redis.client.set(cacheKey, JSON.stringify({ rate: normalizedRate, updatedAt: updatedAt.toISOString() }), "EX", ttl); } catch { /* Cache write failure does not invalidate a fresh provider response. */ }
    return { rate: normalizedRate, updatedAt, source: "coingecko" };
  }

  private isFresh(updatedAt: Date) {
    const ageSeconds = Date.now() / 1000 - updatedAt.getTime() / 1000;
    return Number.isFinite(ageSeconds) && ageSeconds >= -30 && ageSeconds <= this.config.get<number>("PRICE_MAX_AGE_SECONDS", 120);
  }

  private normalizeRate(raw: string) {
    const [mantissa, exponentText] = raw.toLowerCase().split("e");
    const exponent = exponentText ? Number(exponentText) : 0;
    const [whole, fraction = ""] = mantissa.split(".");
    const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
    const scale = fraction.length - exponent;
    if (!Number.isInteger(exponent) || Math.abs(exponent) > 30 || scale > 12 || scale < -12) {
      throw new ServiceUnavailableException("Price precision is outside the supported range.");
    }
    if (scale <= 0) return `${digits}${"0".repeat(-scale)}`;
    const padded = digits.padStart(scale + 1, "0");
    return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
  }
}
