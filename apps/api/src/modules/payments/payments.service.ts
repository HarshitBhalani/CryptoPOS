import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { BillStatus, PaymentAttemptStatus, QuoteStatus } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { SubmitPaymentDto } from "./dto/submit-payment.dto";
import { isValidSolanaAddress } from "../../blockchain/solana.validator";
import { DEVNET_USDC_MINT, DEVNET_USDC_DECIMALS } from "../../blockchain/solana.constants";

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Submit a signed Solana transaction for a payment quote.
   *
   * Design note (Phase 6):
   * The API receives the customer-signed transaction signature and reference,
   * validates the quote is ACTIVE + not expired + bill is OPEN, then persists
   * a PaymentAttempt with status PENDING. It does NOT mark the bill as PAID.
   * Phase 7's independent indexer will verify the on-chain transaction and
   * update the payment status after confirmed finality.
   *
   * The API validates:
   * - Quote exists, is ACTIVE, and not expired
   * - Bill is OPEN
   * - Quote recipients (merchantRecipient / feeRecipient) are immutable snapshots
   * - Mint and decimals match Devnet USDC
   * - reference uniqueness (Solana Pay idempotency key)
   * - signature uniqueness
   * - Idempotency: if attempt already exists for this quoteId, return existing
   */
  async submitPayment(paymentToken: string, dto: SubmitPaymentDto) {
    // Validate Solana public key format for customerWallet and reference
    if (!isValidSolanaAddress(dto.customerWallet)) {
      throw new ConflictException("customerWallet is not a valid Solana public key");
    }
    if (!isValidSolanaAddress(dto.reference)) {
      throw new ConflictException("reference is not a valid Solana public key");
    }

    // Load the quote with bill and merchant
    const quote = await this.prisma.paymentQuote.findUnique({
      where: { id: dto.quoteId },
      include: {
        bill: { select: { id: true, publicToken: true, status: true, merchantId: true } },
      },
    });

    if (!quote) throw new NotFoundException("Quote not found");
    if (quote.bill.publicToken !== paymentToken) {
      throw new NotFoundException("Quote does not belong to this payment link");
    }

    // Bill must be OPEN
    if (quote.bill.status !== BillStatus.OPEN) {
      throw new ConflictException("Bill is no longer open for payment");
    }

    // Quote must be ACTIVE and not expired
    const now = new Date();
    if (quote.status !== QuoteStatus.ACTIVE || quote.expiresAt <= now) {
      throw new ConflictException("Quote has expired. Please request a fresh quote.");
    }

    // Validate immutable recipient snapshot â€” must have been set at quote creation
    if (!quote.merchantRecipient || !isValidSolanaAddress(quote.merchantRecipient)) {
      throw new ConflictException("Quote is missing a valid merchant recipient snapshot. Please request a fresh quote.");
    }

    // Validate mint and decimals match Devnet USDC
    if (quote.tokenMint !== DEVNET_USDC_MINT) {
      throw new ConflictException("Quote references an unsupported token mint. Only Devnet USDC is accepted.");
    }
    if (quote.tokenDecimals !== DEVNET_USDC_DECIMALS) {
      throw new ConflictException("Quote token decimals mismatch. Expected 6 decimals for Devnet USDC.");
    }

    // Validate quote reference consistency if already set
    if (quote.reference && quote.reference !== dto.reference) {
      throw new ConflictException("Reference does not match the reference already set on this quote.");
    }

    // Idempotency: check if attempt already exists for this quoteId
    const existingAttempt = await this.prisma.paymentAttempt.findUnique({
      where: { quoteId: dto.quoteId },
    });
    if (existingAttempt) {
      if (existingAttempt.reference !== dto.reference) {
        throw new ConflictException("A payment attempt with a different reference already exists for this quote.");
      }
      return this.serializeAttempt(existingAttempt);
    }

    // Check reference uniqueness (across all attempts)
    const refConflict = await this.prisma.paymentAttempt.findUnique({
      where: { reference: dto.reference },
    });
    if (refConflict) {
      throw new ConflictException("Payment reference already used. Please retry with a new quote.");
    }

    // Check signature uniqueness
    if (dto.signature) {
      const sigConflict = await this.prisma.paymentAttempt.findFirst({
        where: { signature: dto.signature },
      });
      if (sigConflict) {
        throw new ConflictException("Transaction signature already recorded.");
      }
    }

    // Set the reference on the quote (Solana Pay idempotency)
    if (!quote.reference) {
      await this.prisma.paymentQuote.update({
        where: { id: quote.id },
        data: { reference: dto.reference },
      });
    } else if (quote.reference !== dto.reference) {
      throw new ConflictException("Reference does not match the reference already set on this quote.");
    }

    // Create PENDING PaymentAttempt â€” never set PAID here
    const attempt = await this.prisma.paymentAttempt.create({
      data: {
        quoteId: quote.id,
        billId: quote.billId,
        merchantId: quote.merchantId,
        customerWallet: dto.customerWallet,
        reference: dto.reference,
        signature: dto.signature || null,
        status: PaymentAttemptStatus.PENDING,
      },
    });

    return this.serializeAttempt(attempt);
  }

  /**
   * Get payment attempt status by quoteId (public â€” no auth required).
   */
  async getAttemptByQuote(paymentToken: string, quoteId: string) {
    const quote = await this.prisma.paymentQuote.findUnique({
      where: { id: quoteId },
      select: {
        id: true,
        cryptoUnits: true,
        tokenDecimals: true,
        bill: { select: { publicToken: true, status: true } },
      },
    });
    if (!quote || quote.bill.publicToken !== paymentToken) {
      throw new NotFoundException("Quote not found");
    }
    const attempt = await this.prisma.paymentAttempt.findUnique({
      where: { quoteId },
      include: {
        verifiedTransaction: {
          select: {
            id: true,
            status: true,
            reviewReason: true,
            slot: true,
            blockTime: true,
            verifiedAt: true,
            amountUnits: true,
          },
        },
      },
    });
    if (!attempt) throw new NotFoundException("No payment attempt found for this quote");
    return {
      ...this.serializeAttempt(attempt),
      billStatus: quote.bill.status,
      isPaid: quote.bill.status === BillStatus.PAID,
      verified: attempt.verifiedTransaction
        ? {
            status: attempt.verifiedTransaction.status,
            reviewReason: attempt.verifiedTransaction.reviewReason,
            verifiedAt: attempt.verifiedTransaction.verifiedAt,
            blockTime: attempt.verifiedTransaction.blockTime,
          }
        : null,
    };
  }

  private serializeAttempt(attempt: {
    id: string;
    quoteId: string;
    billId: string;
    merchantId: string;
    customerWallet: string;
    reference: string;
    signature: string | null;
    status: PaymentAttemptStatus;
    submittedAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: attempt.id,
      quoteId: attempt.quoteId,
      billId: attempt.billId,
      reference: attempt.reference,
      signature: attempt.signature,
      status: attempt.status,
      submittedAt: attempt.submittedAt,
      updatedAt: attempt.updatedAt,
      // Never expose customerWallet or merchantId in public response
    };
  }
}

\n