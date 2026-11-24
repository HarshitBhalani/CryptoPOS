import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Connection, Keypair } from "@solana/web3.js";
import {
  BillStatus,
  Prisma,
  RefundStatus,
  VerificationStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { LedgerService } from "../ledger/ledger.service";
import {
  DEVNET_USDC_MINT,
  DEVNET_USDC_DECIMALS,
} from "../../blockchain/solana.constants";
import { isValidSolanaAddress } from "../../blockchain/solana.validator";
import { verifyRefundTransaction } from "../../blockchain/solana.verifier";
import { RequestRefundDto } from "./dto/request-refund.dto";
import { ListRefundsQueryDto } from "./dto/list-refunds-query.dto";

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);
  private connection!: Connection;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ledgerService: LedgerService
  ) {
    const rpcUrl = this.config.get<string>("SOLANA_RPC_URL", "https://api.devnet.solana.com");
    this.connection = new Connection(rpcUrl, "finalized");
  }

  /**
   * Set custom connection for testing.
   */
  setConnection(conn: Connection) {
    this.connection = conn;
  }

  /**
   * Request a new full or partial refund against a finalized verified payment.
   *
   * Enforces:
   * - Verified transaction MUST be in CONFIRMED status.
   * - Cumulative active refund units (REQUESTED, APPROVED, PENDING, CONFIRMED) cannot exceed verified base amount.
   * - Platform fees paid to separate fee wallet are non-refundable by the merchant.
   * - Exact integer smallest units (BigInt).
   * - Valid 32-byte Base58 Solana public key.
   */
  async requestRefund(
    merchantId: string,
    userId: string,
    body: RequestRefundDto,
    idempotencyKey: string
  ) {
    // 1. Check idempotency
    const existing = await this.prisma.refund.findUnique({
      where: { idempotencyKey },
      include: { auditLogs: true, verifiedTx: true },
    });
    if (existing) {
      this.logger.debug(`Refund with idempotency key ${idempotencyKey} already exists. Returning.`);
      return this.serializeRefund(existing);
    }

    // 2. Validate verified transaction
    const verifiedTx = await this.prisma.verifiedTransaction.findUnique({
      where: { id: body.verifiedTxId },
      include: {
        bill: { include: { merchant: true } },
      },
    });

    if (!verifiedTx || verifiedTx.bill.merchantId !== merchantId) {
      throw new NotFoundException("Verified payment transaction not found for this merchant.");
    }

    if (verifiedTx.status !== VerificationStatus.CONFIRMED) {
      throw new ConflictException(
        `Only finalized CONFIRMED payments are refundable. Current status: ${verifiedTx.status}`
      );
    }

    // 3. Validate merchant settlement wallet
    const merchant = verifiedTx.bill.merchant;
    if (!merchant.settlementAddr || !isValidSolanaAddress(merchant.settlementAddr)) {
      throw new BadRequestException("Merchant settlement wallet is not configured or invalid.");
    }
    const sourceWallet = merchant.settlementAddr;

    // 4. Validate exact amount units
    let requestedUnits: bigint;
    try {
      requestedUnits = BigInt(body.amountUnits);
    } catch {
      throw new BadRequestException("amountUnits must be a valid integer string.");
    }

    if (requestedUnits <= 0n) {
      throw new BadRequestException("Refund amountUnits must be greater than zero.");
    }

    // 5. Calculate remaining refundable balance inside transaction to prevent race conditions
    return this.prisma.$transaction(async (txPrisma) => {
      // Find all active refunds for this transaction
      const activeRefunds = await txPrisma.refund.findMany({
        where: {
          verifiedTxId: verifiedTx.id,
          status: {
            in: [
              RefundStatus.REQUESTED,
              RefundStatus.APPROVED,
              RefundStatus.PENDING,
              RefundStatus.CONFIRMED,
            ],
          },
        },
        select: { amountUnits: true },
      });

      let totalReservedUnits = 0n;
      for (const r of activeRefunds) {
        totalReservedUnits += r.amountUnits;
      }

      const maxRefundableUnits = verifiedTx.amountUnits; // merchant base amount (excludes platform fee)
      const remainingUnits = maxRefundableUnits - totalReservedUnits;

      if (requestedUnits > remainingUnits) {
        throw new BadRequestException(
          `Requested refund amount (${formatUnits(requestedUnits, 6)} USDC) exceeds remaining refundable balance (${formatUnits(remainingUnits, 6)} USDC). Note: platform fee (${formatUnits(verifiedTx.feeUnits, 6)} USDC) is non-refundable.`
        );
      }

      // 6. Resolve destination wallet
      let destinationWallet = verifiedTx.sourceOwner;
      let isDestinationOverridden = false;

      if (body.destinationWallet && body.destinationWallet.trim()) {
        const customDest = body.destinationWallet.trim();
        if (!isValidSolanaAddress(customDest)) {
          throw new BadRequestException("Invalid destination Solana wallet address.");
        }
        if (customDest !== verifiedTx.sourceOwner) {
          destinationWallet = customDest;
          isDestinationOverridden = true;
        }
      }

      // Proportional fiat calculation
      let fiatAmount: Prisma.Decimal | null = null;
      if (verifiedTx.bill.total && verifiedTx.amountUnits > 0n) {
        const ratio = Number(requestedUnits) / Number(verifiedTx.amountUnits);
        fiatAmount = new Prisma.Decimal(
          (verifiedTx.bill.total.toNumber() * ratio).toFixed(2)
        );
      }

      // 7. Create Refund record
      const refund = await txPrisma.refund.create({
        data: {
          merchantId,
          billId: verifiedTx.billId,
          verifiedTxId: verifiedTx.id,
          amountUnits: requestedUnits,
          currency: "USDC",
          fiatAmount,
          fiatCurrency: verifiedTx.bill.currency,
          destinationWallet,
          isDestinationOverridden,
          sourceWallet,
          reason: body.reason,
          status: RefundStatus.REQUESTED,
          idempotencyKey,
          requestedById: userId,
          auditLogs: {
            create: {
              actorId: userId,
              action: "REQUESTED",
              fromStatus: null,
              toStatus: RefundStatus.REQUESTED,
              notes: body.reason,
            },
          },
        },
        include: {
          auditLogs: { orderBy: { createdAt: "desc" } },
          bill: true,
          verifiedTx: true,
        },
      });

      this.logger.log(`Created refund request ${refund.id} for bill ${verifiedTx.billId} (${requestedUnits} units).`);
      return this.serializeRefund(refund);
    });
  }

  /**
   * Approve a refund request. Owner-only action.
   * Generates a unique Solana Pay reference for on-chain tracking and returns signing payload.
   */
  async approveRefund(merchantId: string, refundId: string, userId: string) {
    const refund = await this.prisma.refund.findFirst({
      where: { id: refundId, merchantId },
      include: { verifiedTx: true },
    });

    if (!refund) {
      throw new NotFoundException("Refund not found.");
    }

    if (refund.status !== RefundStatus.REQUESTED && refund.status !== RefundStatus.FAILED) {
      throw new ConflictException(
        `Cannot approve refund in status ${refund.status}. Must be REQUESTED or FAILED.`
      );
    }

    // Generate unique Solana Pay reference keypair
    const refKeypair = Keypair.generate();
    const reference = refKeypair.publicKey.toBase58();

    const updated = await this.prisma.$transaction(async (txPrisma) => {
      // Re-validate remaining balance to ensure no concurrent approvals over-commit
      const activeRefunds = await txPrisma.refund.findMany({
        where: {
          verifiedTxId: refund.verifiedTxId,
          id: { not: refund.id },
          status: {
            in: [
              RefundStatus.REQUESTED,
              RefundStatus.APPROVED,
              RefundStatus.PENDING,
              RefundStatus.CONFIRMED,
            ],
          },
        },
        select: { amountUnits: true },
      });

      let otherReservedUnits = 0n;
      for (const r of activeRefunds) {
        otherReservedUnits += r.amountUnits;
      }

      if (otherReservedUnits + refund.amountUnits > refund.verifiedTx.amountUnits) {
        throw new BadRequestException("Refund exceeds available refundable balance.");
      }

      const res = await txPrisma.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.APPROVED,
          approvedById: userId,
          approvedAt: new Date(),
          reference,
          failureReason: null,
          auditLogs: {
            create: {
              actorId: userId,
              action: "APPROVED",
              fromStatus: refund.status,
              toStatus: RefundStatus.APPROVED,
              notes: "Approved by merchant owner for wallet signing.",
            },
          },
        },
        include: { auditLogs: { orderBy: { createdAt: "desc" } } },
      });

      return res;
    });

    this.logger.log(`Refund ${refund.id} approved by owner ${userId}.`);

    return {
      refund: this.serializeRefund(updated),
      signingPayload: {
        refundId: updated.id,
        sourceWallet: updated.sourceWallet,
        destinationWallet: updated.destinationWallet,
        mint: DEVNET_USDC_MINT,
        decimals: DEVNET_USDC_DECIMALS,
        amountUnits: updated.amountUnits.toString(),
        reference,
        network: "devnet",
      },
    };
  }

  /**
   * Reject a refund request. Owner-only action. Releases reserved balance.
   */
  async rejectRefund(merchantId: string, refundId: string, userId: string, reason: string) {
    const refund = await this.prisma.refund.findFirst({
      where: { id: refundId, merchantId },
    });

    if (!refund) {
      throw new NotFoundException("Refund not found.");
    }

    if (refund.status !== RefundStatus.REQUESTED && refund.status !== RefundStatus.APPROVED) {
      throw new ConflictException(
        `Cannot reject refund in status ${refund.status}. Must be REQUESTED or APPROVED.`
      );
    }

    const updated = await this.prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: RefundStatus.REJECTED,
        rejectedById: userId,
        rejectedAt: new Date(),
        rejectionReason: reason,
        auditLogs: {
          create: {
            actorId: userId,
            action: "REJECTED",
            fromStatus: refund.status,
            toStatus: RefundStatus.REJECTED,
            notes: reason,
          },
        },
      },
      include: { auditLogs: { orderBy: { createdAt: "desc" } } },
    });

    this.logger.log(`Refund ${refund.id} rejected by owner ${userId}.`);
    return this.serializeRefund(updated);
  }

  /**
   * Record signed transaction submission broadcast from merchant Phantom wallet.
   * Sets status to PENDING (never marks CONFIRMED from client submission).
   */
  async submitRefund(merchantId: string, refundId: string, userId: string, signature: string) {
    const refund = await this.prisma.refund.findFirst({
      where: { id: refundId, merchantId },
    });

    if (!refund) {
      throw new NotFoundException("Refund not found.");
    }

    if (refund.status !== RefundStatus.APPROVED && refund.status !== RefundStatus.FAILED) {
      throw new ConflictException(
        `Cannot submit transaction for refund in status ${refund.status}. Must be APPROVED.`
      );
    }

    // Check signature uniqueness
    const existingSig = await this.prisma.refund.findFirst({
      where: { signature, id: { not: refund.id } },
    });
    if (existingSig) {
      throw new ConflictException("Transaction signature has already been used for another refund.");
    }

    const updated = await this.prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: RefundStatus.PENDING,
        signature,
        auditLogs: {
          create: {
            actorId: userId,
            action: "SUBMITTED",
            fromStatus: refund.status,
            toStatus: RefundStatus.PENDING,
            notes: `Signature broadcast to Devnet: ${signature}`,
          },
        },
      },
      include: { auditLogs: { orderBy: { createdAt: "desc" } } },
    });

    this.logger.log(`Refund ${refund.id} submitted with signature ${signature}. Now PENDING verification.`);
    return this.serializeRefund(updated);
  }

  /**
   * Independently verify a refund transaction on-chain at finalized commitment.
   * Atomically settles refund, posts double-entry ledger adjustment, and updates Bill status.
   */
  async verifyAndConfirmRefund(refundId: string, passedTx?: any) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: {
        bill: { include: { verifiedTransactions: true } },
        verifiedTx: true,
      },
    });

    if (!refund) {
      throw new NotFoundException(`Refund ${refundId} not found.`);
    }

    if (refund.status === RefundStatus.CONFIRMED) {
      return { verified: true, refund: this.serializeRefund(refund) };
    }

    if (!refund.signature) {
      return { verified: false, reason: "No transaction signature submitted yet." };
    }

    let tx = passedTx;
    if (!tx) {
      try {
        tx = await this.connection.getTransaction(refund.signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        });
      } catch (err: any) {
        this.logger.warn(`RPC error fetching refund tx ${refund.signature}: ${err.message}`);
        return { verified: false, reason: err.message };
      }
    }

    if (!tx) {
      this.logger.debug(`Refund tx ${refund.signature} not yet visible or finalized on RPC.`);
      return { verified: false, pending: true };
    }

    const verification = verifyRefundTransaction(tx, {
      amountUnits: refund.amountUnits,
      sourceWallet: refund.sourceWallet,
      destinationWallet: refund.destinationWallet,
      reference: refund.reference,
      tokenMint: DEVNET_USDC_MINT,
    });

    if (!verification.isValid) {
      this.logger.warn(`Refund ${refund.id} verification failed: ${verification.failureReason}`);

      const failedRefund = await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.FAILED,
          failedAt: new Date(),
          failureReason: verification.failureReason,
          auditLogs: {
            create: {
              actorId: "verifier",
              action: "FAILED",
              fromStatus: refund.status,
              toStatus: RefundStatus.FAILED,
              notes: verification.failureReason,
            },
          },
        },
        include: { auditLogs: { orderBy: { createdAt: "desc" } } },
      });

      return { verified: false, refund: this.serializeRefund(failedRefund) };
    }

    // Atomic confirmation and ledger posting
    const confirmedRefund = await this.prisma.$transaction(async (txPrisma) => {
      // 1. Mark refund confirmed
      const updated = await txPrisma.refund.update({
        where: { id: refund.id },
        data: {
          status: RefundStatus.CONFIRMED,
          slot: verification.slot,
          blockTime: verification.blockTime,
          confirmedAt: new Date(),
          auditLogs: {
            create: {
              actorId: "verifier",
              action: "CONFIRMED",
              fromStatus: refund.status,
              toStatus: RefundStatus.CONFIRMED,
              notes: `Verified on-chain at slot ${verification.slot}.`,
            },
          },
        },
        include: { auditLogs: { orderBy: { createdAt: "desc" } } },
      });

      // 2. Post append-only ledger adjustment
      const journal = await this.ledgerService.postRefundAdjustment(updated.id, txPrisma);
      updated.ledgerJournalId = journal.id;

      // 3. Update Bill status (PARTIALLY_REFUNDED or REFUNDED)
      const allConfirmedRefunds = await txPrisma.refund.findMany({
        where: {
          billId: refund.billId,
          status: RefundStatus.CONFIRMED,
        },
        select: { amountUnits: true },
      });

      let totalRefunded = 0n;
      for (const r of allConfirmedRefunds) {
        totalRefunded += r.amountUnits;
      }

      let totalPaid = 0n;
      for (const vt of refund.bill.verifiedTransactions) {
        if (vt.status === VerificationStatus.CONFIRMED) {
          totalPaid += vt.amountUnits;
        }
      }

      let newBillStatus: BillStatus = BillStatus.PARTIALLY_REFUNDED;
      if (totalPaid > 0n && totalRefunded >= totalPaid) {
        newBillStatus = BillStatus.REFUNDED;
      }

      await txPrisma.bill.update({
        where: { id: refund.billId },
        data: { status: newBillStatus },
      });

      return updated;
    });

    this.logger.log(`Refund ${refund.id} CONFIRMED and settled to ledger.`);
    return { verified: true, refund: this.serializeRefund(confirmedRefund) };
  }

  /**
   * Verify a refund by merchantId and refundId.
   */
  async verifyRefundById(merchantId: string, refundId: string) {
    const refund = await this.prisma.refund.findFirst({
      where: { id: refundId, merchantId },
    });
    if (!refund) throw new NotFoundException("Refund not found.");
    return this.verifyAndConfirmRefund(refund.id);
  }

  /**
   * Background indexer batch processor for pending refunds.
   */
  async processPendingRefunds(): Promise<{ processed: number; confirmed: number }> {
    const pendingRefunds = await this.prisma.refund.findMany({
      where: {
        status: RefundStatus.PENDING,
        signature: { not: null },
      },
      take: 20,
      orderBy: { updatedAt: "asc" },
    });

    let processed = 0;
    let confirmed = 0;

    for (const r of pendingRefunds) {
      processed++;
      const result = await this.verifyAndConfirmRefund(r.id);
      if (result.verified) confirmed++;
    }

    return { processed, confirmed };
  }

  /**
   * List paginated refunds for merchant.
   */
  async listRefundsForMerchant(merchantId: string, query: ListRefundsQueryDto) {
    const where: Prisma.RefundWhereInput = { merchantId };
    if (query.billId) where.billId = query.billId;
    if (query.status) where.status = query.status;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [refunds, total] = await Promise.all([
      this.prisma.refund.findMany({
        where,
        include: {
          auditLogs: { orderBy: { createdAt: "desc" } },
          verifiedTx: { select: { signature: true, amountUnits: true, sourceOwner: true } },
          bill: { select: { number: true, total: true, currency: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      this.prisma.refund.count({ where }),
    ]);

    return {
      refunds: refunds.map((r) => this.serializeRefund(r)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Get single refund detail with full audit log and linked journal.
   */
  async getRefundDetail(merchantId: string, refundId: string) {
    const refund = await this.prisma.refund.findFirst({
      where: { id: refundId, merchantId },
      include: {
        auditLogs: { orderBy: { createdAt: "desc" } },
        verifiedTx: true,
        bill: true,
        ledgerJournal: {
          include: { entries: { include: { account: true } } },
        },
        requestedBy: { select: { id: true, name: true, email: true } },
        approvedBy: { select: { id: true, name: true, email: true } },
        rejectedBy: { select: { id: true, name: true, email: true } },
      },
    });

    if (!refund) throw new NotFoundException("Refund not found.");
    return this.serializeRefund(refund);
  }

  /**
   * Get refundable balance and breakdown for a bill.
   */
  async getRefundableSummaryForBill(merchantId: string, billId: string) {
    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, merchantId },
      include: {
        verifiedTransactions: {
          where: { status: VerificationStatus.CONFIRMED },
        },
        refunds: {
          where: {
            status: {
              in: [
                RefundStatus.REQUESTED,
                RefundStatus.APPROVED,
                RefundStatus.PENDING,
                RefundStatus.CONFIRMED,
              ],
            },
          },
        },
      },
    });

    if (!bill) throw new NotFoundException("Bill not found.");

    let totalPaidUnits = 0n;
    let totalFeeUnits = 0n;
    for (const vt of bill.verifiedTransactions) {
      totalPaidUnits += vt.amountUnits;
      totalFeeUnits += vt.feeUnits;
    }

    let totalReservedRefundUnits = 0n;
    let totalConfirmedRefundUnits = 0n;
    for (const r of bill.refunds) {
      totalReservedRefundUnits += r.amountUnits;
      if (r.status === RefundStatus.CONFIRMED) {
        totalConfirmedRefundUnits += r.amountUnits;
      }
    }

    const remainingRefundableUnits =
      totalPaidUnits > totalReservedRefundUnits ? totalPaidUnits - totalReservedRefundUnits : 0n;

    return {
      billId: bill.id,
      billNumber: bill.number,
      billStatus: bill.status,
      totalPaidUnits: totalPaidUnits.toString(),
      formattedTotalPaid: formatUnits(totalPaidUnits, 6),
      totalFeeUnits: totalFeeUnits.toString(),
      formattedTotalFee: formatUnits(totalFeeUnits, 6),
      totalConfirmedRefundUnits: totalConfirmedRefundUnits.toString(),
      formattedTotalConfirmedRefund: formatUnits(totalConfirmedRefundUnits, 6),
      totalReservedRefundUnits: totalReservedRefundUnits.toString(),
      remainingRefundableUnits: remainingRefundableUnits.toString(),
      formattedRemainingRefundable: formatUnits(remainingRefundableUnits, 6),
      isRefundable: remainingRefundableUnits > 0n && bill.verifiedTransactions.length > 0,
      feePolicyNote:
        "Platform fees were deposited directly to the platform fee wallet and are non-refundable. Only merchant settlement funds can be refunded.",
      verifiedTransactions: bill.verifiedTransactions.map((vt) => ({
        id: vt.id,
        signature: vt.signature,
        amountUnits: vt.amountUnits.toString(),
        formattedAmount: formatUnits(vt.amountUnits, 6),
        sourceOwner: vt.sourceOwner,
        destinationOwner: vt.destinationOwner,
        blockTime: vt.blockTime,
      })),
      activeRefunds: bill.refunds.map((r) => ({
        id: r.id,
        status: r.status,
        amountUnits: r.amountUnits.toString(),
        formattedAmount: formatUnits(r.amountUnits, 6),
        destinationWallet: r.destinationWallet,
        createdAt: r.createdAt,
      })),
    };
  }

  private serializeRefund(refund: any) {
    return {
      id: refund.id,
      merchantId: refund.merchantId,
      billId: refund.billId,
      verifiedTxId: refund.verifiedTxId,
      amountUnits: refund.amountUnits.toString(),
      formattedAmount: formatUnits(refund.amountUnits, 6),
      currency: refund.currency,
      fiatAmount: refund.fiatAmount ? refund.fiatAmount.toFixed(2) : null,
      fiatCurrency: refund.fiatCurrency,
      destinationWallet: refund.destinationWallet,
      isDestinationOverridden: refund.isDestinationOverridden,
      sourceWallet: refund.sourceWallet,
      reason: refund.reason,
      status: refund.status,
      idempotencyKey: refund.idempotencyKey,
      requestedById: refund.requestedById,
      approvedById: refund.approvedById,
      approvedAt: refund.approvedAt,
      rejectedById: refund.rejectedById,
      rejectedAt: refund.rejectedAt,
      rejectionReason: refund.rejectionReason,
      signature: refund.signature,
      reference: refund.reference,
      slot: refund.slot?.toString(),
      blockTime: refund.blockTime,
      confirmedAt: refund.confirmedAt,
      failedAt: refund.failedAt,
      failureReason: refund.failureReason,
      ledgerJournalId: refund.ledgerJournalId,
      createdAt: refund.createdAt,
      updatedAt: refund.updatedAt,
      auditLogs: refund.auditLogs?.map((log: any) => ({
        id: log.id,
        actorId: log.actorId,
        action: log.action,
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        notes: log.notes,
        createdAt: log.createdAt,
      })),
      bill: refund.bill,
      verifiedTx: refund.verifiedTx
        ? {
            id: refund.verifiedTx.id,
            signature: refund.verifiedTx.signature,
            amountUnits: refund.verifiedTx.amountUnits.toString(),
            sourceOwner: refund.verifiedTx.sourceOwner,
          }
        : undefined,
      ledgerJournal: refund.ledgerJournal,
      requestedBy: refund.requestedBy,
      approvedBy: refund.approvedBy,
      rejectedBy: refund.rejectedBy,
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
