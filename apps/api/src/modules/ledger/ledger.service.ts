import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  JournalType,
  LedgerAccountType,
  LedgerEntryDirection,
  Prisma,
  RefundStatus,
  VerificationStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma.service";
import {
  CHART_OF_ACCOUNTS,
  LEDGER_CODE_MERCHANT_SALES,
  LEDGER_CODE_MERCHANT_SETTLEMENT,
  LEDGER_CODE_PLATFORM_FEE_RECEIVABLE,
  LEDGER_CODE_PLATFORM_FEE_REVENUE,
} from "./ledger.constants";
import { ListJournalsQueryDto } from "./dto/list-journals-query.dto";

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get or create a standard double-entry ledger account.
   * Merchant-scoped accounts carry a merchantId; platform-scoped accounts have merchantId = null.
   */
  async getOrCreateAccount(
    merchantId: string | null,
    code: string,
    currency = "USDC",
    network = "devnet",
    prismaClient: Prisma.TransactionClient | PrismaService = this.prisma
  ) {
    const def = CHART_OF_ACCOUNTS[code];
    if (!def) {
      throw new BadRequestException(`Unknown ledger account code: ${code}`);
    }

    const effectiveMerchantId = def.isPlatformScoped ? null : merchantId;

    const existing = await prismaClient.ledgerAccount.findFirst({
      where: {
        merchantId: effectiveMerchantId,
        code,
        currency,
      },
    });

    if (existing) return existing;

    return prismaClient.ledgerAccount.create({
      data: {
        merchantId: effectiveMerchantId,
        code,
        name: def.name,
        type: def.type,
        currency,
        network,
      },
    });
  }

  /**
   * Post an append-only double-entry settlement journal for a verified on-chain payment.
   *
   * Enforces:
   * - Verified transaction MUST be in CONFIRMED status.
   * - Strict integer arithmetic using exact smallest units (BigInt).
   * - Strict journal balancing: sum(debits) === sum(credits).
   * - Idempotency: only one PAYMENT_SETTLEMENT journal can ever be created for a verified tx.
   * - Platform fee separation: fees are credited to platform revenue, never counted as merchant sales.
   */
  async postPaymentSettlement(verifiedTxId: string) {
    // 1. Load verified transaction and its associated quote and bill
    const verifiedTx = await this.prisma.verifiedTransaction.findUnique({
      where: { id: verifiedTxId },
      include: {
        quote: true,
        bill: true,
      },
    });

    if (!verifiedTx) {
      throw new NotFoundException(`Verified transaction ${verifiedTxId} not found.`);
    }

    if (verifiedTx.status !== VerificationStatus.CONFIRMED) {
      throw new ConflictException(
        `Cannot post payment settlement for unconfirmed transaction. Current status is ${verifiedTx.status}.`
      );
    }

    // 2. Check for existing settlement journal (idempotent retry safe)
    const existingJournal = await this.prisma.ledgerJournal.findFirst({
      where: {
        verifiedTxId: verifiedTx.id,
        type: JournalType.PAYMENT_SETTLEMENT,
      },
      include: {
        entries: { include: { account: true } },
      },
    });

    if (existingJournal) {
      this.logger.debug(`Settlement journal already exists for verified tx ${verifiedTx.id}. Returning existing.`);
      return this.serializeJournal(existingJournal);
    }

    const merchantId = verifiedTx.bill.merchantId;
    const currency = verifiedTx.quote.tokenSymbol || "USDC";
    const network = "devnet";
    const amountUnits = verifiedTx.amountUnits; // merchant base amount in smallest units
    const feeUnits = verifiedTx.feeUnits; // platform fee in smallest units

    if (amountUnits <= 0n) {
      throw new BadRequestException("Verified transaction merchant amount must be greater than zero.");
    }

    // 3. Prepare entries inside a database transaction to guarantee balance & atomicity
    const journal = await this.prisma.$transaction(async (txPrisma) => {
      // Ensure merchant accounts exist
      const merchantSettlementAcc = await this.getOrCreateAccount(
        merchantId,
        LEDGER_CODE_MERCHANT_SETTLEMENT,
        currency,
        network,
        txPrisma
      );

      const merchantSalesAcc = await this.getOrCreateAccount(
        merchantId,
        LEDGER_CODE_MERCHANT_SALES,
        currency,
        network,
        txPrisma
      );

      // Ensure platform fee accounts exist if fee applies
      let platformFeeReceivableAcc: any = null;
      let platformFeeRevenueAcc: any = null;
      if (feeUnits > 0n) {
        platformFeeReceivableAcc = await this.getOrCreateAccount(
          null,
          LEDGER_CODE_PLATFORM_FEE_RECEIVABLE,
          currency,
          network,
          txPrisma
        );
        platformFeeRevenueAcc = await this.getOrCreateAccount(
          null,
          LEDGER_CODE_PLATFORM_FEE_REVENUE,
          currency,
          network,
          txPrisma
        );
      }

      // Build planned entries
      const plannedEntries: Array<{
        accountId: string;
        direction: LedgerEntryDirection;
        amountUnits: bigint;
        entryOrder: number;
      }> = [];

      let order = 0;

      // Merchant Settlement:
      // DEBIT 1110 (Merchant settlement wallet asset)
      // CREDIT 4100 (Merchant sales revenue)
      plannedEntries.push({
        accountId: merchantSettlementAcc.id,
        direction: LedgerEntryDirection.DEBIT,
        amountUnits,
        entryOrder: ++order,
      });

      plannedEntries.push({
        accountId: merchantSalesAcc.id,
        direction: LedgerEntryDirection.CREDIT,
        amountUnits,
        entryOrder: ++order,
      });

      // Platform Fee (if feeUnits > 0):
      // DEBIT 1120 (Platform fee direct asset)
      // CREDIT 4200 (Platform fee revenue)
      if (feeUnits > 0n && platformFeeReceivableAcc && platformFeeRevenueAcc) {
        plannedEntries.push({
          accountId: platformFeeReceivableAcc.id,
          direction: LedgerEntryDirection.DEBIT,
          amountUnits: feeUnits,
          entryOrder: ++order,
        });

        plannedEntries.push({
          accountId: platformFeeRevenueAcc.id,
          direction: LedgerEntryDirection.CREDIT,
          amountUnits: feeUnits,
          entryOrder: ++order,
        });
      }

      // 4. Assert journal balance
      let totalDebits = 0n;
      let totalCredits = 0n;
      for (const entry of plannedEntries) {
        if (entry.direction === LedgerEntryDirection.DEBIT) {
          totalDebits += entry.amountUnits;
        } else {
          totalCredits += entry.amountUnits;
        }
      }

      if (totalDebits !== totalCredits) {
        throw new BadRequestException(
          `Unbalanced ledger journal: total debits (${totalDebits}) do not equal total credits (${totalCredits}).`
        );
      }

      const idempotencyKey = `settle_${verifiedTx.signature}`;

      // 5. Create LedgerJournal
      const createdJournal = await txPrisma.ledgerJournal.create({
        data: {
          merchantId,
          billId: verifiedTx.billId,
          verifiedTxId: verifiedTx.id,
          type: JournalType.PAYMENT_SETTLEMENT,
          currency,
          network,
          idempotencyKey,
          description: `Settlement for Bill #${verifiedTx.bill.number} via tx ${verifiedTx.signature.slice(0, 8)}...`,
          totalDebitUnits: totalDebits,
          totalCreditUnits: totalCredits,
          fiatAmount: verifiedTx.bill.total,
          fiatCurrency: verifiedTx.bill.currency,
          entries: {
            create: plannedEntries.map((e) => ({
              accountId: e.accountId,
              direction: e.direction,
              amountUnits: e.amountUnits,
              entryOrder: e.entryOrder,
            })),
          },
        },
        include: {
          entries: { include: { account: true } },
        },
      });

      return createdJournal;
    });

    this.logger.log(`Posted balanced settlement journal ${journal.id} for verified tx ${verifiedTx.signature}.`);
    return this.serializeJournal(journal);
  }

  /**
   * Reverse an existing journal immutably.
   * Creates an opposing journal with flipped debits and credits linked via originalJournalId.
   */
  async reverseJournal(merchantId: string, journalId: string, reason: string, actor: string) {
    const original = await this.prisma.ledgerJournal.findFirst({
      where: { id: journalId, merchantId },
      include: {
        entries: true,
        reversalJournals: true,
      },
    });

    if (!original) {
      throw new NotFoundException("Journal not found.");
    }

    if (original.type === JournalType.REVERSAL) {
      throw new ConflictException("Cannot reverse a reversal journal.");
    }

    if (original.reversalJournals.length > 0) {
      throw new ConflictException("This journal has already been reversed.");
    }

    const reversalIdempotencyKey = `reversal_${original.id}_${Date.now()}`;

    const reversed = await this.prisma.$transaction(async (txPrisma) => {
      // Build opposing entries: DEBIT -> CREDIT, CREDIT -> DEBIT
      const opposingEntries = original.entries.map((entry, index) => ({
        accountId: entry.accountId,
        direction:
          entry.direction === LedgerEntryDirection.DEBIT
            ? LedgerEntryDirection.CREDIT
            : LedgerEntryDirection.DEBIT,
        amountUnits: entry.amountUnits,
        entryOrder: index + 1,
      }));

      // Validate opposing balance
      let debits = 0n;
      let credits = 0n;
      for (const e of opposingEntries) {
        if (e.direction === LedgerEntryDirection.DEBIT) debits += e.amountUnits;
        else credits += e.amountUnits;
      }

      if (debits !== credits) {
        throw new BadRequestException("Unbalanced reversal journal.");
      }

      return txPrisma.ledgerJournal.create({
        data: {
          merchantId: original.merchantId,
          billId: original.billId,
          type: JournalType.REVERSAL,
          currency: original.currency,
          network: original.network,
          idempotencyKey: reversalIdempotencyKey,
          description: `Reversal of journal ${original.id}. Reason: ${reason} (by ${actor})`,
          totalDebitUnits: debits,
          totalCreditUnits: credits,
          fiatAmount: original.fiatAmount,
          fiatCurrency: original.fiatCurrency,
          originalJournalId: original.id,
          reversalReason: reason,
          entries: {
            create: opposingEntries.map((e) => ({
              accountId: e.accountId,
              direction: e.direction,
              amountUnits: e.amountUnits,
              entryOrder: e.entryOrder,
            })),
          },
        },
        include: {
          entries: { include: { account: true } },
        },
      });
    });

    this.logger.log(`Posted reversal journal ${reversed.id} for original journal ${original.id}.`);
    return this.serializeJournal(reversed);
  }

  /**
   * Post an append-only double-entry refund adjustment journal for a finalized on-chain refund.
   *
   * Enforces:
   * - Refund MUST be in CONFIRMED status.
   * - Exact integer smallest units (BigInt).
   * - Balanced journal: DEBIT 4100_MERCHANT_SALES === CREDIT 1110_USDC_MERCHANT_SETTLEMENT.
   * - Idempotency via idempotencyKey: `refund_settle_${refund.id}`.
   * - Links original payment journal if available.
   */
  async postRefundAdjustment(
    refundId: string,
    prismaClient: Prisma.TransactionClient | PrismaService = this.prisma
  ) {
    const refund = await prismaClient.refund.findUnique({
      where: { id: refundId },
      include: {
        bill: true,
        verifiedTx: {
          include: {
            ledgerJournals: {
              where: { type: JournalType.PAYMENT_SETTLEMENT },
            },
          },
        },
      },
    });

    if (!refund) {
      throw new NotFoundException(`Refund ${refundId} not found.`);
    }

    if (refund.status !== RefundStatus.CONFIRMED) {
      throw new ConflictException(
        `Cannot post refund ledger adjustment for unconfirmed refund. Current status: ${refund.status}`
      );
    }

    const idempotencyKey = `refund_settle_${refund.id}`;
    const existing = await prismaClient.ledgerJournal.findUnique({
      where: { idempotencyKey },
      include: { entries: { include: { account: true } } },
    });
    if (existing) {
      return this.serializeJournal(existing);
    }

    const merchantId = refund.merchantId;
    const currency = refund.currency || "USDC";
    const network = "devnet";
    const amountUnits = refund.amountUnits;

    // Ensure merchant accounts exist
    const merchantSalesAcc = await this.getOrCreateAccount(
      merchantId,
      LEDGER_CODE_MERCHANT_SALES,
      currency,
      network,
      prismaClient
    );
    const merchantSettlementAcc = await this.getOrCreateAccount(
      merchantId,
      LEDGER_CODE_MERCHANT_SETTLEMENT,
      currency,
      network,
      prismaClient
    );

    const originalJournal = refund.verifiedTx.ledgerJournals[0];

    // Refund adjustment entries:
    // DEBIT 4100_MERCHANT_SALES (reduces revenue)
    // CREDIT 1110_USDC_MERCHANT_SETTLEMENT (reduces asset)
    const journal = await prismaClient.ledgerJournal.create({
      data: {
        merchantId,
        billId: refund.billId,
        verifiedTxId: refund.verifiedTxId,
        type: JournalType.ADJUSTMENT,
        currency,
        network,
        idempotencyKey,
        description: `Refund for Bill #${refund.bill.number} (${formatUnits(amountUnits, 6)} ${currency}). Reason: ${refund.reason}`,
        totalDebitUnits: amountUnits,
        totalCreditUnits: amountUnits,
        fiatAmount: refund.fiatAmount,
        fiatCurrency: refund.fiatCurrency,
        originalJournalId: originalJournal?.id ?? null,
        reversalReason: refund.reason,
        entries: {
          create: [
            {
              accountId: merchantSalesAcc.id,
              direction: LedgerEntryDirection.DEBIT,
              amountUnits,
              entryOrder: 1,
            },
            {
              accountId: merchantSettlementAcc.id,
              direction: LedgerEntryDirection.CREDIT,
              amountUnits,
              entryOrder: 2,
            },
          ],
        },
      },
      include: {
        entries: { include: { account: true } },
      },
    });

    // Link journal to refund
    await prismaClient.refund.update({
      where: { id: refund.id },
      data: { ledgerJournalId: journal.id },
    });

    this.logger.log(`Posted balanced refund adjustment journal ${journal.id} for refund ${refund.id}.`);
    return this.serializeJournal(journal);
  }

  /**
   * List paginated journals for an active merchant.
   */
  async listJournalsForMerchant(merchantId: string, query: ListJournalsQueryDto) {
    const where: Prisma.LedgerJournalWhereInput = { merchantId };

    if (query.billId) where.billId = query.billId;
    if (query.type) where.type = query.type;
    if (query.startDate || query.endDate) {
      where.postedAt = {};
      if (query.startDate) where.postedAt.gte = new Date(query.startDate);
      if (query.endDate) where.postedAt.lte = new Date(query.endDate);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [journals, total] = await Promise.all([
      this.prisma.ledgerJournal.findMany({
        where,
        include: {
          entries: { include: { account: true } },
          reversalJournals: { select: { id: true, postedAt: true, reversalReason: true } },
        },
        orderBy: { postedAt: "desc" },
        skip,
        take: pageSize,
      }),
      this.prisma.ledgerJournal.count({ where }),
    ]);

    return {
      journals: journals.map((j) => this.serializeJournal(j)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Get single journal detail with balanced entries.
   */
  async getJournalDetail(merchantId: string, journalId: string) {
    const journal = await this.prisma.ledgerJournal.findFirst({
      where: { id: journalId, merchantId },
      include: {
        entries: { include: { account: true } },
        originalJournal: {
          select: { id: true, type: true, description: true, postedAt: true },
        },
        reversalJournals: {
          select: { id: true, type: true, description: true, postedAt: true, reversalReason: true },
        },
        verifiedTx: {
          select: { signature: true, status: true, slot: true, blockTime: true },
        },
        bill: {
          select: { number: true, total: true, currency: true, status: true },
        },
      },
    });

    if (!journal) throw new NotFoundException("Journal not found.");
    return this.serializeJournal(journal);
  }

  /**
   * List chart of accounts with aggregate balances for a merchant.
   */
  async listAccountsForMerchant(merchantId: string) {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { merchantId },
      include: {
        entries: {
          select: { direction: true, amountUnits: true },
        },
      },
      orderBy: { code: "asc" },
    });

    return {
      accounts: accounts.map((acc) => {
        let totalDebits = 0n;
        let totalCredits = 0n;
        for (const e of acc.entries) {
          if (e.direction === LedgerEntryDirection.DEBIT) {
            totalDebits += e.amountUnits;
          } else {
            totalCredits += e.amountUnits;
          }
        }

        // For Assets & Expenses: normal balance is Debit (debit - credit)
        // For Liabilities, Equity & Revenue: normal balance is Credit (credit - debit)
        const isNormalDebit =
          acc.type === LedgerAccountType.ASSET || acc.type === LedgerAccountType.EXPENSE;
        const netUnits = isNormalDebit ? totalDebits - totalCredits : totalCredits - totalDebits;

        return {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          type: acc.type,
          currency: acc.currency,
          network: acc.network,
          totalDebitUnits: totalDebits.toString(),
          totalCreditUnits: totalCredits.toString(),
          netUnits: netUnits.toString(),
          formattedNet: formatUnits(netUnits, 6),
        };
      }),
    };
  }

  /**
   * Run reconciliation checks to identify:
   * 1. Confirmed verified payments that have no ledger settlement journal.
   * 2. Unbalanced journals (totalDebitUnits !== totalCreditUnits).
   * 3. Discrepancies between verified transaction amount and journal totals.
   * 4. Duplicate source events.
   */
  async getReconciliationReport(merchantId?: string) {
    const txWhere: Prisma.VerifiedTransactionWhereInput = {
      status: VerificationStatus.CONFIRMED,
    };
    if (merchantId) {
      txWhere.bill = { merchantId };
    }

    const confirmedTxs = await this.prisma.verifiedTransaction.findMany({
      where: txWhere,
      include: {
        ledgerJournals: true,
        bill: { select: { id: true, number: true, merchantId: true } },
      },
    });

    const unpostedPayments: Array<{
      verifiedTxId: string;
      signature: string;
      billNumber: string;
      amountUnits: string;
      verifiedAt: Date;
    }> = [];

    const amountMismatches: Array<{
      journalId: string;
      signature: string;
      verifiedUnits: string;
      journalUnits: string;
    }> = [];

    for (const tx of confirmedTxs) {
      const settlementJournal = tx.ledgerJournals.find(
        (j) => j.type === JournalType.PAYMENT_SETTLEMENT
      );
      if (!settlementJournal) {
        unpostedPayments.push({
          verifiedTxId: tx.id,
          signature: tx.signature,
          billNumber: tx.bill.number,
          amountUnits: tx.amountUnits.toString(),
          verifiedAt: tx.verifiedAt,
        });
      } else {
        const expectedTotal = tx.amountUnits + tx.feeUnits;
        if (settlementJournal.totalDebitUnits !== expectedTotal) {
          amountMismatches.push({
            journalId: settlementJournal.id,
            signature: tx.signature,
            verifiedUnits: expectedTotal.toString(),
            journalUnits: settlementJournal.totalDebitUnits.toString(),
          });
        }
      }
    }

    // Check for unbalanced journals in DB
    const journalWhere: Prisma.LedgerJournalWhereInput = {};
    if (merchantId) journalWhere.merchantId = merchantId;
    const allJournals = await this.prisma.ledgerJournal.findMany({
      where: journalWhere,
      select: {
        id: true,
        totalDebitUnits: true,
        totalCreditUnits: true,
        type: true,
      },
    });

    const unbalancedJournals = allJournals
      .filter((j) => j.totalDebitUnits !== j.totalCreditUnits)
      .map((j) => ({
        journalId: j.id,
        type: j.type,
        debitUnits: j.totalDebitUnits.toString(),
        creditUnits: j.totalCreditUnits.toString(),
      }));

    // Check for confirmed refunds without posted ledger journals
    const refundWhere: Prisma.RefundWhereInput = {
      status: RefundStatus.CONFIRMED,
    };
    if (merchantId) refundWhere.merchantId = merchantId;
    const confirmedRefunds = await this.prisma.refund.findMany({
      where: refundWhere,
      include: { ledgerJournal: true, bill: { select: { number: true } } },
    });

    const unpostedRefunds: Array<{
      refundId: string;
      signature: string;
      billNumber: string;
      amountUnits: string;
    }> = [];

    for (const r of confirmedRefunds) {
      if (!r.ledgerJournal) {
        unpostedRefunds.push({
          refundId: r.id,
          signature: r.signature ?? "",
          billNumber: r.bill.number,
          amountUnits: r.amountUnits.toString(),
        });
      }
    }

    const isReconciled =
      unpostedPayments.length === 0 &&
      unpostedRefunds.length === 0 &&
      unbalancedJournals.length === 0 &&
      amountMismatches.length === 0;

    return {
      isReconciled,
      summary: {
        totalConfirmedPaymentsChecked: confirmedTxs.length,
        totalConfirmedRefundsChecked: confirmedRefunds.length,
        totalJournalsChecked: allJournals.length,
        unpostedPaymentsCount: unpostedPayments.length,
        unpostedRefundsCount: unpostedRefunds.length,
        unbalancedJournalsCount: unbalancedJournals.length,
        amountMismatchesCount: amountMismatches.length,
      },
      discrepancies: {
        unpostedPayments,
        unpostedRefunds,
        unbalancedJournals,
        amountMismatches,
      },
    };
  }

  private serializeJournal(journal: any) {
    return {
      id: journal.id,
      merchantId: journal.merchantId,
      billId: journal.billId,
      verifiedTxId: journal.verifiedTxId,
      type: journal.type,
      currency: journal.currency,
      network: journal.network,
      idempotencyKey: journal.idempotencyKey,
      description: journal.description,
      totalDebitUnits: journal.totalDebitUnits.toString(),
      totalCreditUnits: journal.totalCreditUnits.toString(),
      formattedTotal: formatUnits(journal.totalDebitUnits, 6),
      fiatAmount: journal.fiatAmount ? journal.fiatAmount.toFixed(2) : null,
      fiatCurrency: journal.fiatCurrency,
      originalJournalId: journal.originalJournalId,
      reversalReason: journal.reversalReason,
      isReversed: Boolean(journal.reversalJournals?.length),
      postedAt: journal.postedAt,
      createdAt: journal.createdAt,
      entries: journal.entries?.map((e: any) => ({
        id: e.id,
        direction: e.direction,
        amountUnits: e.amountUnits.toString(),
        formattedAmount: formatUnits(e.amountUnits, 6),
        entryOrder: e.entryOrder,
        account: e.account
          ? {
              id: e.account.id,
              code: e.account.code,
              name: e.account.name,
              type: e.account.type,
            }
          : undefined,
      })),
      bill: journal.bill,
      verifiedTx: journal.verifiedTx
        ? {
            ...journal.verifiedTx,
            slot: journal.verifiedTx.slot?.toString(),
          }
        : undefined,
      originalJournal: journal.originalJournal,
      reversals: journal.reversalJournals,
    };
  }
}

function formatUnits(units: bigint, decimals: number): string {
  const isNegative = units < 0n;
  const abs = isNegative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0");
  const result = decimals ? `${whole}.${fraction}` : whole.toString();
  return isNegative ? `-${result}` : result;
}
