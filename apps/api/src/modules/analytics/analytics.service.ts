import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { Prisma } from "@prisma/client";

export interface DateRange {
  start: Date;
  end: Date;
}

export function formatTokenUnits(units: bigint, decimals: number = 6): string {
  const isNegative = units < 0n;
  const absUnits = isNegative ? -units : units;
  const divisor = 10n ** BigInt(decimals);
  const integerPart = absUnits / divisor;
  const fractionalPart = absUnits % divisor;
  const fracStr = fractionalPart.toString().padStart(decimals, "0");
  const result = `${integerPart.toString()}.${fracStr}`;
  return isNegative ? `-${result}` : result;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private parseAndValidateDateRange(startStr?: string, endStr?: string): DateRange {
    const end = endStr ? new Date(endStr) : new Date();
    if (isNaN(end.getTime())) {
      throw new BadRequestException("Invalid endDate parameter. Expected ISO-8601 string.");
    }

    const start = startStr
      ? new Date(startStr)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (isNaN(start.getTime())) {
      throw new BadRequestException("Invalid startDate parameter. Expected ISO-8601 string.");
    }

    if (start > end) {
      throw new BadRequestException("startDate must be earlier than or equal to endDate.");
    }

    const maxRangeMs = 365 * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > maxRangeMs) {
      throw new BadRequestException("Requested date range exceeds the maximum limit of 365 days.");
    }

    return { start, end };
  }

  async getMerchantOverview(
    merchantId: string,
    query: { startDate?: string; endDate?: string; tokenSymbol?: string; currency?: string }
  ) {
    const { start, end } = this.parseAndValidateDateRange(query.startDate, query.endDate);
    const tokenSymbol = query.tokenSymbol || "USDC";
    const fiatCurrency = query.currency || "USD";

    // 1. Fetch confirmed verified transactions for this merchant within date range
    const verifiedTxs = await this.prisma.verifiedTransaction.findMany({
      where: {
        status: "CONFIRMED",
        bill: { merchantId },
        verifiedAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        amountUnits: true,
        feeUnits: true,
        verifiedAt: true,
        bill: {
          select: {
            id: true,
            total: true,
            currency: true,
          },
        },
      },
    });

    // 2. Fetch confirmed refunds for this merchant within date range
    const refunds = await this.prisma.refund.findMany({
      where: {
        merchantId,
        status: "CONFIRMED",
        confirmedAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        amountUnits: true,
        fiatAmount: true,
        fiatCurrency: true,
        confirmedAt: true,
      },
    });

    // 3. Exact integer calculation for token amounts (Devnet USDC, 6 decimals)
    let grossSalesUnits = 0n;
    let platformFeeUnits = 0n;
    let fiatGrossSales = new Prisma.Decimal(0);

    for (const tx of verifiedTxs) {
      grossSalesUnits += tx.amountUnits;
      platformFeeUnits += tx.feeUnits;
      if (tx.bill && tx.bill.currency === fiatCurrency) {
        fiatGrossSales = fiatGrossSales.plus(tx.bill.total);
      }
    }

    let refundUnits = 0n;
    let fiatRefunds = new Prisma.Decimal(0);
    for (const ref of refunds) {
      refundUnits += ref.amountUnits;
      if (ref.fiatAmount && (ref.fiatCurrency || "USD") === fiatCurrency) {
        fiatRefunds = fiatRefunds.plus(ref.fiatAmount);
      }
    }

    const netSalesUnits = grossSalesUnits - refundUnits;
    const transactionCount = verifiedTxs.length;
    const refundCount = refunds.length;

    const averagePaymentUnits =
      transactionCount > 0 ? grossSalesUnits / BigInt(transactionCount) : 0n;

    const fiatNetSales = fiatGrossSales.minus(fiatRefunds);

    // 4. Bill status distribution within date range
    const billCounts = await this.prisma.bill.groupBy({
      by: ["status"],
      where: {
        merchantId,
        createdAt: { gte: start, lte: end },
      },
      _count: {
        status: true,
      },
    });

    const statusBreakdown: Record<string, number> = {};
    for (const b of billCounts) {
      statusBreakdown[b.status] = b._count.status;
    }

    // 5. Double-entry ledger audit check for this merchant
    const ledgerJournals = await this.prisma.ledgerJournal.findMany({
      where: {
        merchantId,
        postedAt: { gte: start, lte: end },
      },
      include: {
        entries: true,
      },
    });

    let totalDebitUnits = 0n;
    let totalCreditUnits = 0n;
    let isLedgerBalanced = true;

    for (const journal of ledgerJournals) {
      let jDebits = 0n;
      let jCredits = 0n;
      for (const entry of journal.entries) {
        if (entry.direction === "DEBIT") jDebits += entry.amountUnits;
        if (entry.direction === "CREDIT") jCredits += entry.amountUnits;
      }
      totalDebitUnits += jDebits;
      totalCreditUnits += jCredits;
      if (jDebits !== jCredits || journal.totalDebitUnits !== journal.totalCreditUnits) {
        isLedgerBalanced = false;
      }
    }

    return {
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
      asset: {
        tokenSymbol,
        network: "devnet",
        decimals: 6,
      },
      cryptoMetrics: {
        grossSalesUnits: grossSalesUnits.toString(),
        grossSalesFormatted: formatTokenUnits(grossSalesUnits, 6),
        refundUnits: refundUnits.toString(),
        refundFormatted: formatTokenUnits(refundUnits, 6),
        netSalesUnits: netSalesUnits.toString(),
        netSalesFormatted: formatTokenUnits(netSalesUnits, 6),
        platformFeeUnits: platformFeeUnits.toString(),
        platformFeeFormatted: formatTokenUnits(platformFeeUnits, 6),
        averagePaymentUnits: averagePaymentUnits.toString(),
        averagePaymentFormatted: formatTokenUnits(averagePaymentUnits, 6),
        transactionCount,
        refundCount,
      },
      fiatMetrics: {
        currency: fiatCurrency,
        grossSales: fiatGrossSales.toFixed(2),
        refunds: fiatRefunds.toFixed(2),
        netSales: fiatNetSales.toFixed(2),
      },
      billStatusDistribution: statusBreakdown,
      ledgerIntegrity: {
        postedJournalsCount: ledgerJournals.length,
        totalDebitUnits: totalDebitUnits.toString(),
        totalCreditUnits: totalCreditUnits.toString(),
        isBalanced: isLedgerBalanced,
      },
    };
  }

  async getMerchantTimeSeries(
    merchantId: string,
    query: { startDate?: string; endDate?: string; tokenSymbol?: string; currency?: string }
  ) {
    const { start, end } = this.parseAndValidateDateRange(query.startDate, query.endDate);
    const tokenSymbol = query.tokenSymbol || "USDC";
    const fiatCurrency = query.currency || "USD";

    // 1. Fetch confirmed verified transactions
    const verifiedTxs = await this.prisma.verifiedTransaction.findMany({
      where: {
        status: "CONFIRMED",
        bill: { merchantId },
        verifiedAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        amountUnits: true,
        feeUnits: true,
        verifiedAt: true,
        bill: {
          select: {
            total: true,
            currency: true,
          },
        },
      },
      orderBy: { verifiedAt: "asc" },
    });

    // 2. Fetch confirmed refunds
    const refunds = await this.prisma.refund.findMany({
      where: {
        merchantId,
        status: "CONFIRMED",
        confirmedAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        amountUnits: true,
        fiatAmount: true,
        fiatCurrency: true,
        confirmedAt: true,
      },
      orderBy: { confirmedAt: "asc" },
    });

    // 3. Bucket by UTC day: YYYY-MM-DD
    type DayBucket = {
      date: string;
      grossSalesUnits: bigint;
      refundUnits: bigint;
      feeUnits: bigint;
      transactionCount: number;
      refundCount: number;
      fiatGross: Prisma.Decimal;
      fiatRefund: Prisma.Decimal;
    };

    const buckets = new Map<string, DayBucket>();

    // Pre-populate all days in range to ensure continuous timeline
    const cur = new Date(start);
    cur.setUTCHours(0, 0, 0, 0);
    const endBoundary = new Date(end);
    endBoundary.setUTCHours(23, 59, 59, 999);

    while (cur <= endBoundary) {
      const dateKey = cur.toISOString().slice(0, 10);
      if (!buckets.has(dateKey)) {
        buckets.set(dateKey, {
          date: dateKey,
          grossSalesUnits: 0n,
          refundUnits: 0n,
          feeUnits: 0n,
          transactionCount: 0,
          refundCount: 0,
          fiatGross: new Prisma.Decimal(0),
          fiatRefund: new Prisma.Decimal(0),
        });
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }

    for (const tx of verifiedTxs) {
      const dateKey = tx.verifiedAt.toISOString().slice(0, 10);
      let bucket = buckets.get(dateKey);
      if (!bucket) {
        bucket = {
          date: dateKey,
          grossSalesUnits: 0n,
          refundUnits: 0n,
          feeUnits: 0n,
          transactionCount: 0,
          refundCount: 0,
          fiatGross: new Prisma.Decimal(0),
          fiatRefund: new Prisma.Decimal(0),
        };
        buckets.set(dateKey, bucket);
      }
      bucket.grossSalesUnits += tx.amountUnits;
      bucket.feeUnits += tx.feeUnits;
      bucket.transactionCount += 1;
      if (tx.bill && tx.bill.currency === fiatCurrency) {
        bucket.fiatGross = bucket.fiatGross.plus(tx.bill.total);
      }
    }

    for (const ref of refunds) {
      const dateKey = (ref.confirmedAt || new Date()).toISOString().slice(0, 10);
      let bucket = buckets.get(dateKey);
      if (!bucket) {
        bucket = {
          date: dateKey,
          grossSalesUnits: 0n,
          refundUnits: 0n,
          feeUnits: 0n,
          transactionCount: 0,
          refundCount: 0,
          fiatGross: new Prisma.Decimal(0),
          fiatRefund: new Prisma.Decimal(0),
        };
        buckets.set(dateKey, bucket);
      }
      bucket.refundUnits += ref.amountUnits;
      bucket.refundCount += 1;
      if (ref.fiatAmount && (ref.fiatCurrency || "USD") === fiatCurrency) {
        bucket.fiatRefund = bucket.fiatRefund.plus(ref.fiatAmount);
      }
    }

    // Convert to sorted list and format output
    const sortedDates = Array.from(buckets.keys()).sort();
    const series = sortedDates.map((d) => {
      const b = buckets.get(d)!;
      const netSalesUnits = b.grossSalesUnits - b.refundUnits;
      const fiatNet = b.fiatGross.minus(b.fiatRefund);

      return {
        date: b.date,
        grossSalesUnits: b.grossSalesUnits.toString(),
        grossSalesFormatted: formatTokenUnits(b.grossSalesUnits, 6),
        refundUnits: b.refundUnits.toString(),
        refundFormatted: formatTokenUnits(b.refundUnits, 6),
        netSalesUnits: netSalesUnits.toString(),
        netSalesFormatted: formatTokenUnits(netSalesUnits, 6),
        feeUnits: b.feeUnits.toString(),
        feeFormatted: formatTokenUnits(b.feeUnits, 6),
        transactionCount: b.transactionCount,
        refundCount: b.refundCount,
        fiatGrossSales: b.fiatGross.toFixed(2),
        fiatRefunds: b.fiatRefund.toFixed(2),
        fiatNetSales: fiatNet.toFixed(2),
      };
    });

    return {
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      },
      asset: {
        tokenSymbol,
        network: "devnet",
        decimals: 6,
      },
      currency: fiatCurrency,
      series,
    };
  }
}
