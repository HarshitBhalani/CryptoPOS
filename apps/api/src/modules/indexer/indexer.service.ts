import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Connection, PublicKey } from "@solana/web3.js";
import { BillStatus, PaymentAttemptStatus, VerificationStatus } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { LedgerService } from "../ledger/ledger.service";
import { RefundsService } from "../refunds/refunds.service";
import { assertDevnetCluster, verifyPaymentTransaction } from "../../blockchain/solana.verifier";
import { DEVNET_USDC_MINT, DEVNET_USDC_DECIMALS } from "../../blockchain/solana.constants";

const LEASE_KEY = "cryptopos:indexer:lease";
const LEASE_TTL_SECONDS = 30;
const CHECKPOINT_KEY = "solana:devnet:indexer";

@Injectable()
export class IndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IndexerService.name);
  private connection!: Connection;
  private isRunning = false;
  private workerId = `worker_${process.pid}_${Date.now()}`;
  private pollIntervalMs = 5000;
  private loopTimer: NodeJS.Timeout | null = null;
  private leaseTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly ledgerService: LedgerService,
    private readonly refundsService: RefundsService,
  ) {}

  async onModuleInit() {
    const rpcUrl = this.config.get<string>("SOLANA_RPC_URL", "https://api.devnet.solana.com");
    this.connection = new Connection(rpcUrl, "finalized");

    // Allow configuring whether the indexer loop starts automatically inside the API server
    // Default to false so it can run as an independent worker process, or true if configured.
    const autoStart = this.config.get<string>("INDEXER_AUTO_START", "false").toLowerCase() === "true";
    if (autoStart) {
      await this.start();
    }
  }

  async onModuleDestroy() {
    await this.stop();
  }

  /**
   * Set custom connection (useful for unit testing with mocks).
   */
  setConnection(conn: Connection) {
    this.connection = conn;
  }

  /**
   * Acquire distributed lease to prevent duplicate workers racing.
   */
  async acquireLease(): Promise<boolean> {
    try {
      const res = await this.redis.client.set(LEASE_KEY, this.workerId, "EX", LEASE_TTL_SECONDS, "NX");
      return res === "OK";
    } catch (err) {
      this.logger.warn(`Failed to connect to Redis for lease check: ${err}`);
      // Fallback: If Redis is unavailable, rely on DB-level unique constraints and atomic locks
      return true;
    }
  }

  /**
   * Renew distributed lease while actively processing.
   */
  async renewLease(): Promise<void> {
    try {
      const current = await this.redis.client.get(LEASE_KEY);
      if (current === this.workerId) {
        await this.redis.client.expire(LEASE_KEY, LEASE_TTL_SECONDS);
      }
    } catch {
      // Ignore lease renewal transient errors
    }
  }

  /**
   * Release distributed lease on worker shutdown.
   */
  async releaseLease(): Promise<void> {
    try {
      const current = await this.redis.client.get(LEASE_KEY);
      if (current === this.workerId) {
        await this.redis.client.del(LEASE_KEY);
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Start the indexer worker loop.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    // Strict Genesis Hash verification before worker begins
    try {
      const hash = await assertDevnetCluster(this.connection);
      this.logger.log(`Solana Devnet genesis hash verified: ${hash}`);
    } catch (err: any) {
      this.logger.error(`Solana Devnet cluster verification failed: ${err.message}. Worker will not start.`);
      throw err;
    }

    this.isRunning = true;
    this.logger.log(`Starting independent Solana Devnet indexer [${this.workerId}]...`);

    const runLoop = async () => {
      if (!this.isRunning) return;
      try {
        const hasLease = await this.acquireLease();
        if (hasLease) {
          await this.runOnce();
          await this.renewLease();
        } else {
          this.logger.debug("Another indexer worker holds the active lease. Waiting...");
        }
      } catch (err: any) {
        this.logger.error(`Error during indexing cycle: ${err.message}`, err.stack);
      } finally {
        if (this.isRunning) {
          this.loopTimer = setTimeout(runLoop, this.pollIntervalMs);
        }
      }
    };

    runLoop();
  }

  /**
   * Stop the indexer worker loop.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    if (this.leaseTimer) clearInterval(this.leaseTimer);
    await this.releaseLease();
    this.logger.log(`Indexer worker [${this.workerId}] stopped.`);
  }

  /**
   * Execute a single indexing pass. Can be called directly by tests or standalone scripts.
   */
  async runOnce(): Promise<{ processedCount: number; verifiedCount: number }> {
    if (this.isProcessing) return { processedCount: 0, verifiedCount: 0 };
    this.isProcessing = true;

    let processedCount = 0;
    let verifiedCount = 0;

    try {
      // 1. Process customer-submitted pending attempts
      const attemptResults = await this.processPendingAttempts();
      processedCount += attemptResults.processed;
      verifiedCount += attemptResults.verified;

      // 2. Discover candidate transactions via Solana Pay references (handles cases where client did not call submit)
      const discoveryResults = await this.discoverTransactionsByReference();
      processedCount += discoveryResults.processed;
      verifiedCount += discoveryResults.verified;

      // 3. Process pending merchant refunds
      const refundResults = await this.refundsService.processPendingRefunds();
      processedCount += refundResults.processed;
      verifiedCount += refundResults.confirmed;

      // 4. Update checkpoint timestamp
      await this.prisma.indexerCheckpoint.upsert({
        where: { key: CHECKPOINT_KEY },
        update: { updatedAt: new Date() },
        create: { key: CHECKPOINT_KEY, lastSlot: 0n },
      });
    } finally {
      this.isProcessing = false;
    }

    return { processedCount, verifiedCount };
  }

  /**
   * 1. Inspect submitted PaymentAttempt records in PENDING status.
   */
  private async processPendingAttempts(): Promise<{ processed: number; verified: number }> {
    const pendingAttempts = await this.prisma.paymentAttempt.findMany({
      where: {
        status: PaymentAttemptStatus.PENDING,
        signature: { not: null },
      },
      include: {
        quote: true,
        bill: true,
      },
      take: 50,
      orderBy: { submittedAt: "asc" },
    });

    let processed = 0;
    let verified = 0;

    for (const attempt of pendingAttempts) {
      if (!attempt.signature) continue;
      processed++;

      // Check if already verified
      const existing = await this.prisma.verifiedTransaction.findUnique({
        where: { signature: attempt.signature },
      });
      if (existing) {
        // Sync attempt status with existing verification
        if (existing.status === VerificationStatus.CONFIRMED && attempt.status !== PaymentAttemptStatus.CONFIRMED) {
          await this.prisma.paymentAttempt.update({
            where: { id: attempt.id },
            data: { status: PaymentAttemptStatus.CONFIRMED },
          });
        }
        if (existing.status === VerificationStatus.CONFIRMED) {
          try {
            await this.ledgerService.postPaymentSettlement(existing.id);
          } catch (err: any) {
            this.logger.warn(`Failed to post ledger settlement for existing tx ${existing.signature}: ${err.message}`);
          }
        }
        continue;
      }

      const success = await this.fetchAndVerifyTransaction(attempt.signature, attempt.quote, attempt.id);
      if (success) verified++;
    }

    return { processed, verified };
  }

  /**
   * 2. Discover unsubmitted transactions by polling Solana Pay references for open bills.
   */
  private async discoverTransactionsByReference(): Promise<{ processed: number; verified: number }> {
    // Look for active quotes belonging to OPEN or PENDING bills
    const activeQuotes = await this.prisma.paymentQuote.findMany({
      where: {
        reference: { not: null },
        bill: { status: { in: [BillStatus.OPEN, BillStatus.PENDING] } },
      },
      include: {
        bill: true,
        paymentAttempts: true,
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    });

    let processed = 0;
    let verified = 0;

    for (const quote of activeQuotes) {
      if (!quote.reference) continue;

      try {
        const refPubkey = new PublicKey(quote.reference);
        const signatures = await this.connection.getSignaturesForAddress(refPubkey, {
          limit: 10,
        });

        for (const sigInfo of signatures) {
          processed++;
          const signature = sigInfo.signature;

          // Check if already verified
          const existing = await this.prisma.verifiedTransaction.findUnique({
            where: { signature },
          });
          if (existing) {
            if (existing.status === VerificationStatus.CONFIRMED) {
              try {
                await this.ledgerService.postPaymentSettlement(existing.id);
              } catch (err: any) {
                this.logger.warn(`Failed to post ledger settlement for discovered tx ${existing.signature}: ${err.message}`);
              }
            }
            continue;
          }

          // Find or associate with attempt if one exists for this quote
          const attempt = quote.paymentAttempts.find((a) => a.signature === signature) ?? quote.paymentAttempts[0];
          const success = await this.fetchAndVerifyTransaction(signature, quote, attempt?.id);
          if (success) verified++;
        }
      } catch (err: any) {
        this.logger.warn(`Error querying signatures for reference ${quote.reference}: ${err.message}`);
      }
    }

    return { processed, verified };
  }

  /**
   * Fetch a transaction at `finalized` commitment and perform verification & atomic state updates.
   */
  async fetchAndVerifyTransaction(
    signature: string,
    quote: {
      id: string;
      billId: string;
      tokenMint: string;
      tokenDecimals: number;
      cryptoUnits: bigint;
      feeUnits: bigint;
      merchantRecipient: string | null;
      feeRecipient: string | null;
      reference: string | null;
      expiresAt: Date;
    },
    attemptId?: string
  ): Promise<boolean> {
    let tx: any;
    try {
      tx = await this.connection.getTransaction(signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
    } catch (err: any) {
      this.logger.warn(`RPC error fetching tx ${signature}: ${err.message}`);
      return false;
    }

    // If transaction is not found or not yet finalized, return false to retry later
    if (!tx) {
      this.logger.debug(`Transaction ${signature} not yet finalized or visible on RPC.`);
      return false;
    }

    const lateGraceSeconds = this.config.get<number>("PAYMENT_LATE_GRACE_SECONDS", 30);
    const verification = verifyPaymentTransaction(tx, quote, { lateGraceSeconds });

    // Execute atomic DB transaction
    await this.prisma.$transaction(async (txPrisma) => {
      // Re-read current bill status inside transaction to avoid race conditions
      const currentBill = await txPrisma.bill.findUnique({
        where: { id: quote.billId },
        select: { status: true },
      });

      if (!currentBill) return;

      // Duplicate payment protection: If bill was already marked PAID, flag as REVIEW_REQUIRED
      let effectiveStatus = verification.status;
      let reviewReason = verification.reviewReason;

      if (currentBill.status === BillStatus.PAID && verification.status === VerificationStatus.CONFIRMED) {
        effectiveStatus = VerificationStatus.OVERPAID;
        reviewReason = "DUPLICATE_PAYMENT: Bill was already marked PAID by a previous transaction.";
      }

      // Check if attemptId is already claimed by a different signature
      let targetAttemptId: string | null = null;
      if (attemptId) {
        const linked = await txPrisma.verifiedTransaction.findUnique({
          where: { attemptId },
          select: { signature: true },
        });
        if (!linked || linked.signature === signature) {
          targetAttemptId = attemptId;
        }
      }

      // 1. Create VerifiedTransaction record (idempotent via unique signature)
      await txPrisma.verifiedTransaction.upsert({
        where: { signature },
        update: {
          status: effectiveStatus,
          reviewReason,
          slot: verification.slot,
          blockTime: verification.blockTime,
          verifiedAt: new Date(),
        },
        create: {
          signature,
          billId: quote.billId,
          quoteId: quote.id,
          attemptId: targetAttemptId,
          slot: verification.slot,
          blockTime: verification.blockTime,
          amountUnits: verification.amountUnits,
          feeUnits: verification.feeUnits,
          tokenMint: verification.tokenMint,
          sourceOwner: verification.sourceOwner,
          destinationOwner: verification.destinationOwner,
          feeDestination: verification.feeDestination,
          reference: verification.reference,
          status: effectiveStatus,
          reviewReason,
          metaRaw: verification.rawMeta as any,
        },
      });

      // 2. Update PaymentAttempt status if an attempt exists
      if (attemptId) {
        let attemptStatus: PaymentAttemptStatus = PaymentAttemptStatus.PENDING;
        if (effectiveStatus === VerificationStatus.CONFIRMED) {
          attemptStatus = PaymentAttemptStatus.CONFIRMED;
        } else if (effectiveStatus === VerificationStatus.FAILED) {
          attemptStatus = PaymentAttemptStatus.FAILED;
        } else {
          attemptStatus = PaymentAttemptStatus.REVIEW_REQUIRED;
        }

        await txPrisma.paymentAttempt.update({
          where: { id: attemptId },
          data: { status: attemptStatus },
        });
      }

      // 3. Atomically update Bill status based on verification result
      let newBillStatus: BillStatus | null = null;
      if (currentBill.status === BillStatus.PAID) {
        // Bill is already settled and PAID — keep it PAID on duplicate / replay transactions
        newBillStatus = null;
      } else {
        switch (effectiveStatus) {
          case VerificationStatus.CONFIRMED:
            newBillStatus = BillStatus.PAID;
            break;
          case VerificationStatus.PARTIAL:
            newBillStatus = BillStatus.PARTIALLY_PAID;
            break;
          case VerificationStatus.OVERPAID:
            newBillStatus = BillStatus.OVERPAID;
            break;
          case VerificationStatus.LATE:
            newBillStatus = BillStatus.PAYMENT_REVIEW;
            break;
          case VerificationStatus.FAILED:
            // If transaction failed on chain, leave bill OPEN so customer can retry
            if (currentBill.status === BillStatus.PENDING) {
              newBillStatus = BillStatus.OPEN;
            }
            break;
          case VerificationStatus.INVALID:
            // Suspicious or invalid transfer leaves bill for review
            newBillStatus = BillStatus.PAYMENT_REVIEW;
            break;
        }
      }

      if (newBillStatus && newBillStatus !== currentBill.status) {
        await txPrisma.bill.update({
          where: { id: quote.billId },
          data: { status: newBillStatus },
        });
        this.logger.log(`Bill ${quote.billId} status updated to ${newBillStatus} via verified tx ${signature}.`);
      }
    });

    // 4. If transaction was verified as CONFIRMED, post to append-only double-entry ledger
    if (verification.status === VerificationStatus.CONFIRMED) {
      try {
        const txRecord = await this.prisma.verifiedTransaction.findUnique({
          where: { signature },
          select: { id: true, status: true },
        });
        if (txRecord && txRecord.status === VerificationStatus.CONFIRMED) {
          await this.ledgerService.postPaymentSettlement(txRecord.id);
        }
      } catch (err: any) {
        this.logger.error(`Failed to post ledger settlement for tx ${signature}: ${err.message}`, err.stack);
      }
    }

    return verification.isValid;
  }
}
