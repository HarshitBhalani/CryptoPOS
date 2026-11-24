import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { MerchantStatus, Prisma } from "@prisma/client";
import { UpdateMerchantStatusDto } from "./dto/update-merchant-status.dto";
import { ListMerchantsQueryDto } from "./dto/list-merchants-query.dto";
import { ListAuditLogsQueryDto } from "./dto/list-audit-logs-query.dto";
import { formatTokenUnits } from "../analytics/analytics.service";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getPlatformOverview() {
    // 1. Merchant counts
    const merchantCounts = await this.prisma.merchant.groupBy({
      by: ["status"],
      _count: { status: true },
    });
    const merchantsByStatus: Record<string, number> = {
      ACTIVE: 0,
      SUSPENDED: 0,
    };
    let totalMerchants = 0;
    for (const m of merchantCounts) {
      merchantsByStatus[m.status] = m._count.status;
      totalMerchants += m._count.status;
    }

    // 2. Bill counts
    const billCounts = await this.prisma.bill.groupBy({
      by: ["status"],
      _count: { status: true },
    });
    const billsByStatus: Record<string, number> = {};
    let totalBills = 0;
    for (const b of billCounts) {
      billsByStatus[b.status] = b._count.status;
      totalBills += b._count.status;
    }

    // 3. Verified transactions volume (Solana Devnet USDC)
    const confirmedTxs = await this.prisma.verifiedTransaction.findMany({
      where: { status: "CONFIRMED" },
      select: { amountUnits: true, feeUnits: true },
    });

    let grossVolumeUnits = 0n;
    let feeVolumeUnits = 0n;
    for (const tx of confirmedTxs) {
      grossVolumeUnits += tx.amountUnits;
      feeVolumeUnits += tx.feeUnits;
    }

    // 4. Confirmed refunds volume
    const confirmedRefunds = await this.prisma.refund.findMany({
      where: { status: "CONFIRMED" },
      select: { amountUnits: true },
    });

    let refundVolumeUnits = 0n;
    for (const ref of confirmedRefunds) {
      refundVolumeUnits += ref.amountUnits;
    }

    const netVolumeUnits = grossVolumeUnits - refundVolumeUnits;

    // 5. Indexer checkpoint status
    const checkpoint = await this.prisma.indexerCheckpoint.findUnique({
      where: { key: "solana_devnet_payment_indexer" },
    });

    // 6. Ledger summary
    const postedJournalsCount = await this.prisma.ledgerJournal.count();

    return {
      network: "devnet",
      token: {
        symbol: "USDC",
        mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
        decimals: 6,
      },
      merchants: {
        total: totalMerchants,
        active: merchantsByStatus.ACTIVE || 0,
        suspended: merchantsByStatus.SUSPENDED || 0,
      },
      bills: {
        total: totalBills,
        byStatus: billsByStatus,
      },
      financialTotals: {
        grossVolumeUnits: grossVolumeUnits.toString(),
        grossVolumeFormatted: formatTokenUnits(grossVolumeUnits, 6),
        refundVolumeUnits: refundVolumeUnits.toString(),
        refundVolumeFormatted: formatTokenUnits(refundVolumeUnits, 6),
        netVolumeUnits: netVolumeUnits.toString(),
        netVolumeFormatted: formatTokenUnits(netVolumeUnits, 6),
        feeVolumeUnits: feeVolumeUnits.toString(),
        feeVolumeFormatted: formatTokenUnits(feeVolumeUnits, 6),
        confirmedTransactionCount: confirmedTxs.length,
        confirmedRefundCount: confirmedRefunds.length,
      },
      ledger: {
        postedJournalsCount,
      },
      indexer: {
        status: checkpoint ? "ACTIVE" : "PENDING_START",
        lastSlot: checkpoint ? checkpoint.lastSlot.toString() : "0",
        lastSignature: checkpoint?.lastSig || null,
        updatedAt: checkpoint?.updatedAt || null,
      },
    };
  }

  async listMerchants(query: ListMerchantsQueryDto) {
    const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || "20", 10) || 20));
    const skip = (page - 1) * pageSize;

    const where: Prisma.MerchantWhereInput = {};
    if (query.status) {
      where.status = query.status;
    }
    if (query.search && query.search.trim()) {
      const s = query.search.trim();
      where.OR = [
        { name: { contains: s, mode: "insensitive" } },
        { settlementAddr: { contains: s, mode: "insensitive" } },
      ];
    }

    const [total, merchants] = await Promise.all([
      this.prisma.merchant.count({ where }),
      this.prisma.merchant.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
        include: {
          members: {
            where: { role: "OWNER" },
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          bills: {
            where: { status: "PAID" },
            select: { id: true },
          },
          wallets: {
            where: { network: "devnet" },
            select: { address: true, purpose: true },
          },
        },
      }),
    ]);

    // Compute volume for each merchant safely
    const merchantIds = merchants.map((m) => m.id);
    const verifiedTxs = await this.prisma.verifiedTransaction.findMany({
      where: {
        status: "CONFIRMED",
        bill: { merchantId: { in: merchantIds } },
      },
      select: {
        amountUnits: true,
        bill: { select: { merchantId: true } },
      },
    });

    const volumeByMerchant = new Map<string, bigint>();
    for (const tx of verifiedTxs) {
      if (tx.bill?.merchantId) {
        const current = volumeByMerchant.get(tx.bill.merchantId) || 0n;
        volumeByMerchant.set(tx.bill.merchantId, current + tx.amountUnits);
      }
    }

    const items = merchants.map((m) => {
      const owner = m.members[0]?.user || null;
      const totalUnits = volumeByMerchant.get(m.id) || 0n;
      const defaultWallet = m.settlementAddr || m.wallets[0]?.address || null;

      return {
        id: m.id,
        name: m.name,
        businessType: m.businessType,
        status: m.status,
        settlementAddress: defaultWallet,
        createdAt: m.createdAt.toISOString(),
        owner: owner
          ? {
              id: owner.id,
              name: owner.name,
              email: owner.email,
            }
          : null,
        paidBillsCount: m.bills.length,
        confirmedVolumeUnits: totalUnits.toString(),
        confirmedVolumeFormatted: formatTokenUnits(totalUnits, 6),
      };
    });

    return {
      items,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getMerchantDetails(merchantId: string) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
        wallets: true,
      },
    });

    if (!merchant) {
      throw new NotFoundException("Merchant not found");
    }

    // Bills counts
    const billCounts = await this.prisma.bill.groupBy({
      by: ["status"],
      where: { merchantId },
      _count: { status: true },
    });
    const billsByStatus: Record<string, number> = {};
    for (const b of billCounts) {
      billsByStatus[b.status] = b._count.status;
    }

    // Volume calculation
    const verifiedTxs = await this.prisma.verifiedTransaction.findMany({
      where: {
        status: "CONFIRMED",
        bill: { merchantId },
      },
      select: { amountUnits: true, feeUnits: true },
    });

    let grossUnits = 0n;
    let feeUnits = 0n;
    for (const tx of verifiedTxs) {
      grossUnits += tx.amountUnits;
      feeUnits += tx.feeUnits;
    }

    const refunds = await this.prisma.refund.findMany({
      where: { merchantId, status: "CONFIRMED" },
      select: { amountUnits: true },
    });
    let refundUnits = 0n;
    for (const ref of refunds) {
      refundUnits += ref.amountUnits;
    }

    // Audit logs for this merchant
    const auditLogs = await this.prisma.adminAuditLog.findMany({
      where: { targetType: "MERCHANT", targetId: merchantId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return {
      merchant: {
        id: merchant.id,
        name: merchant.name,
        businessType: merchant.businessType,
        status: merchant.status,
        settlementAddress: merchant.settlementAddr,
        createdAt: merchant.createdAt.toISOString(),
      },
      members: merchant.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        merchantRole: m.role,
      })),
      wallets: merchant.wallets.map((w) => ({
        address: w.address,
        network: w.network,
        purpose: w.purpose,
        createdAt: w.createdAt,
      })),
      volume: {
        grossUnits: grossUnits.toString(),
        grossFormatted: formatTokenUnits(grossUnits, 6),
        refundUnits: refundUnits.toString(),
        refundFormatted: formatTokenUnits(refundUnits, 6),
        netUnits: (grossUnits - refundUnits).toString(),
        netFormatted: formatTokenUnits(grossUnits - refundUnits, 6),
        feeUnits: feeUnits.toString(),
        feeFormatted: formatTokenUnits(feeUnits, 6),
        transactionCount: verifiedTxs.length,
        refundCount: refunds.length,
      },
      billsByStatus,
      auditLogs,
    };
  }

  async updateMerchantStatus(
    actorId: string,
    merchantId: string,
    dto: UpdateMerchantStatusDto
  ) {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
    });
    if (!merchant) {
      throw new NotFoundException("Merchant not found");
    }

    if (merchant.status === dto.status) {
      return {
        merchant,
        message: `Merchant is already in ${dto.status} status.`,
      };
    }

    const previousStatus = merchant.status;

    // Look up actor email
    const actorUser = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { email: true },
    });
    const actorEmail = actorUser?.email || actorId;

    // Execute status update and audit log write inside a transaction
    const [updatedMerchant, auditLog] = await this.prisma.$transaction([
      this.prisma.merchant.update({
        where: { id: merchantId },
        data: { status: dto.status },
      }),
      this.prisma.adminAuditLog.create({
        data: {
          actorId,
          actorEmail,
          action: "UPDATE_MERCHANT_STATUS",
          targetType: "MERCHANT",
          targetId: merchantId,
          details: {
            merchantName: merchant.name,
            previousStatus,
            newStatus: dto.status,
            reason: dto.reason.trim(),
          },
        },
      }),
    ]);

    return {
      success: true,
      merchant: updatedMerchant,
      auditLog,
    };
  }

  async listAuditLogs(query: ListAuditLogsQueryDto) {
    const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || "25", 10) || 25));
    const skip = (page - 1) * pageSize;

    const where: Prisma.AdminAuditLogWhereInput = {};
    if (query.action) {
      where.action = query.action;
    }
    if (query.targetType) {
      where.targetType = query.targetType;
    }

    const [total, items] = await Promise.all([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      items,
      pagination: {
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getLedgerReconciliation() {
    const postedJournals = await this.prisma.ledgerJournal.findMany({
      include: {
        entries: true,
        merchant: { select: { id: true, name: true } },
      },
      orderBy: { postedAt: "desc" },
    });

    let systemTotalDebits = 0n;
    let systemTotalCredits = 0n;
    const imbalancedJournals: any[] = [];

    for (const j of postedJournals) {
      let jDebits = 0n;
      let jCredits = 0n;
      for (const entry of j.entries) {
        if (entry.direction === "DEBIT") jDebits += entry.amountUnits;
        if (entry.direction === "CREDIT") jCredits += entry.amountUnits;
      }
      systemTotalDebits += jDebits;
      systemTotalCredits += jCredits;

      if (jDebits !== jCredits || j.totalDebitUnits !== j.totalCreditUnits) {
        imbalancedJournals.push({
          journalId: j.id,
          idempotencyKey: j.idempotencyKey,
          merchantId: j.merchantId,
          merchantName: j.merchant?.name,
          debits: jDebits.toString(),
          credits: jCredits.toString(),
          difference: (jDebits - jCredits).toString(),
        });
      }
    }

    const isSystemBalanced =
      imbalancedJournals.length === 0 && systemTotalDebits === systemTotalCredits;

    return {
      isSystemBalanced,
      totalJournalsAudited: postedJournals.length,
      systemTotalDebitUnits: systemTotalDebits.toString(),
      systemTotalDebitFormatted: formatTokenUnits(systemTotalDebits, 6),
      systemTotalCreditUnits: systemTotalCredits.toString(),
      systemTotalCreditFormatted: formatTokenUnits(systemTotalCredits, 6),
      imbalancedCount: imbalancedJournals.length,
      imbalancedJournals,
    };
  }
}
