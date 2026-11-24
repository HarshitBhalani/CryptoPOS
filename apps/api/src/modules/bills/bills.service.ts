import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BillStatus, Prisma, QuoteStatus } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma.service";
import { CreateBillDto } from "./dto/create-bill.dto";
import { ListBillsQueryDto } from "./dto/list-bills-query.dto";
import { DEVNET_NETWORK, SUPPORTED_DEVNET_TOKEN } from "../../blockchain/solana.constants";

const ZERO = new Prisma.Decimal(0);
const MAX_BILL_TOTAL = new Prisma.Decimal("1000000000000000000");

@Injectable()
export class BillsService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async create(merchantId: string, dto: CreateBillDto, idempotencyKey: string) {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) throw new BadRequestException("A valid Idempotency-Key header is required");
    const taxRate = new Prisma.Decimal(dto.taxRate ?? "0");
    if (taxRate.lt(0) || taxRate.gt(100)) throw new ConflictException("Tax rate must be between 0 and 100 percent");
    const requestHash = this.hashRequest(dto, taxRate);
    const existing = await this.prisma.bill.findUnique({ where: { merchantId_idempotencyKey: { merchantId, idempotencyKey } }, include: { items: true } });
    if (existing) return this.withPaymentUrl(existing, existing.requestHash === requestHash ? undefined : "Idempotency key was already used for a different bill");
    let subtotal = ZERO;
    const items = dto.items.map((item) => {
      const quantity = new Prisma.Decimal(item.quantity);
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      if (!quantity.isFinite() || quantity.lte(0)) throw new ConflictException("Quantity must be greater than zero");
      if (!unitPrice.isFinite() || unitPrice.lt(0)) throw new ConflictException("Unit price cannot be negative");
      const lineTotal = quantity.mul(unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      if (lineTotal.gte(MAX_BILL_TOTAL)) throw new ConflictException("Bill amount exceeds the supported limit");
      subtotal = subtotal.plus(lineTotal);
      return { description: item.description.trim(), quantity, unitPrice, lineTotal };
    });
    subtotal = subtotal.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const taxAmount = subtotal.mul(taxRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const total = subtotal.plus(taxAmount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    if (total.lte(0)) throw new ConflictException("Bill total must be greater than zero");
    if (subtotal.gte(MAX_BILL_TOTAL) || taxAmount.gte(MAX_BILL_TOTAL) || total.gte(MAX_BILL_TOTAL)) throw new ConflictException("Bill amount exceeds the supported limit");

    const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const number = `CPOS-${today}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const publicToken = randomBytes(32).toString("base64url");
    try {
      const bill = await this.prisma.bill.create({
        data: {
          merchantId,
          idempotencyKey,
          requestHash,
          number,
          publicToken,
          description: dto.description?.trim() || null,
          customerName: dto.customerName?.trim() || null,
          customerEmail: dto.customerEmail?.trim().toLowerCase() || null,
          currency: dto.currency,
          subtotal,
          taxRate,
          taxAmount,
          total,
          status: BillStatus.OPEN,
          items: { create: items },
        },
        include: { items: true },
      });
      return this.withPaymentUrl(bill);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const duplicate = await this.prisma.bill.findUnique({ where: { merchantId_idempotencyKey: { merchantId, idempotencyKey } }, include: { items: true } });
        if (duplicate) return this.withPaymentUrl(duplicate, duplicate.requestHash === requestHash ? undefined : "Idempotency key was already used for a different bill");
      }
      throw error;
    }
  }

  async list(merchantId: string, query: ListBillsQueryDto) {
    const where: Prisma.BillWhereInput = {
      merchantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { OR: [
        { number: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
        { customerName: { contains: query.search, mode: "insensitive" } },
        { customerEmail: { contains: query.search, mode: "insensitive" } },
      ] } : {}),
    };
    const [bills, total] = await this.prisma.$transaction([
      this.prisma.bill.findMany({ where, include: { items: true }, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.bill.count({ where }),
    ]);
    return { bills: bills.map((bill) => this.serializeBill(bill)), total, page: query.page, pageSize: query.pageSize };
  }

  async summary(merchantId: string) {
    const groups = await this.prisma.bill.groupBy({ by: ["status"], where: { merchantId }, _count: { _all: true } });
    const byStatus = Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
    return { total: groups.reduce((sum, group) => sum + group._count._all, 0), byStatus };
  }

  async get(merchantId: string, billId: string) {
    const bill = await this.prisma.bill.findFirst({ where: { id: billId, merchantId }, include: { items: true, merchant: { select: { id: true, name: true, status: true } } } });
    if (!bill) throw new NotFoundException("Bill not found");
    const baseUrl = this.config.getOrThrow<string>("FRONTEND_URL").replace(/\/$/, "");
    return { ...this.serializeBill(bill), paymentUrl: `${baseUrl}/pay/${bill.publicToken}` };
  }

  async cancel(merchantId: string, billId: string) {
    const bill = await this.prisma.bill.findFirst({ where: { id: billId, merchantId }, select: { id: true, status: true } });
    if (!bill) throw new NotFoundException("Bill not found");
    if (bill.status !== BillStatus.OPEN) throw new ConflictException("Only open, unpaid bills can be cancelled");
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.bill.updateMany({ where: { id: billId, merchantId, status: BillStatus.OPEN }, data: { status: BillStatus.CANCELLED } });
      if (changed.count !== 1) throw new ConflictException("Bill status changed; refresh and try again");
      await tx.paymentQuote.updateMany({ where: { billId, merchantId, status: QuoteStatus.ACTIVE }, data: { status: QuoteStatus.EXPIRED } });
    });
    return this.get(merchantId, billId);
  }

  async getPublic(paymentToken: string) {
    const bill = await this.prisma.bill.findUnique({
      where: { publicToken: paymentToken },
      select: {
        number: true,
        description: true,
        currency: true,
        subtotal: true,
        taxRate: true,
        taxAmount: true,
        total: true,
        status: true,
        createdAt: true,
        merchant: { select: { name: true, settlementAddr: true } },
        items: { select: { description: true, quantity: true, unitPrice: true, lineTotal: true } },
      },
    });
    if (!bill) throw new NotFoundException("Payment link not found");
    const serialized = this.serializeBill(bill);
    return {
      ...serialized,
      merchant: {
        name: bill.merchant.name,
        settlementAddress: bill.merchant.settlementAddr,
      },
      network: DEVNET_NETWORK,
      supportedToken: SUPPORTED_DEVNET_TOKEN,
      isSettlementConfigured: Boolean(bill.merchant.settlementAddr),
    };
  }

  async getPaymentsForBill(merchantId: string, billId: string) {
    const bill = await this.prisma.bill.findFirst({
      where: { id: billId, merchantId },
      include: {
        verifiedTransactions: {
          orderBy: { verifiedAt: "desc" },
        },
        paymentAttempts: {
          orderBy: { submittedAt: "desc" },
        },
      },
    });
    if (!bill) throw new NotFoundException("Bill not found");
    return {
      billId: bill.id,
      number: bill.number,
      status: bill.status,
      total: bill.total.toFixed(2),
      currency: bill.currency,
      verifiedTransactions: bill.verifiedTransactions.map((vt) => ({
        id: vt.id,
        signature: vt.signature,
        slot: vt.slot.toString(),
        blockTime: vt.blockTime,
        status: vt.status,
        amountUnits: vt.amountUnits.toString(),
        feeUnits: vt.feeUnits.toString(),
        tokenMint: vt.tokenMint,
        sourceOwner: vt.sourceOwner,
        destinationOwner: vt.destinationOwner,
        feeDestination: vt.feeDestination,
        reference: vt.reference,
        reviewReason: vt.reviewReason,
        verifiedAt: vt.verifiedAt,
      })),
      paymentAttempts: bill.paymentAttempts.map((pa) => ({
        id: pa.id,
        reference: pa.reference,
        signature: pa.signature,
        status: pa.status,
        submittedAt: pa.submittedAt,
      })),
    };
  }

  async listPaymentsForReview(merchantId: string) {
    const bills = await this.prisma.bill.findMany({
      where: {
        merchantId,
        status: { in: [BillStatus.PARTIALLY_PAID, BillStatus.OVERPAID, BillStatus.PAYMENT_REVIEW] },
      },
      include: {
        items: true,
        verifiedTransactions: {
          orderBy: { verifiedAt: "desc" },
        },
        paymentAttempts: {
          orderBy: { submittedAt: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    return {
      bills: bills.map((bill) => ({
        ...this.serializeBill(bill),
        reviewReason: bill.verifiedTransactions[0]?.reviewReason ?? "Under review",
        verifiedTransactions: bill.verifiedTransactions.map((vt) => ({
          id: vt.id,
          signature: vt.signature,
          status: vt.status,
          amountUnits: vt.amountUnits.toString(),
          reviewReason: vt.reviewReason,
          verifiedAt: vt.verifiedAt,
          blockTime: vt.blockTime,
        })),
      })),
      total: bills.length,
    };
  }

  private serializeBill<T extends { subtotal: Prisma.Decimal; taxRate: Prisma.Decimal; taxAmount: Prisma.Decimal; total: Prisma.Decimal; items: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }[] }>(bill: T) {
    return {
      ...bill,
      subtotal: bill.subtotal.toFixed(2),
      taxRate: bill.taxRate.toString(),
      taxAmount: bill.taxAmount.toFixed(2),
      total: bill.total.toFixed(2),
      items: bill.items.map((item) => ({ ...item, quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(), lineTotal: item.lineTotal.toFixed(2) })),
    };
  }

  private withPaymentUrl<T extends { publicToken: string; subtotal: Prisma.Decimal; taxRate: Prisma.Decimal; taxAmount: Prisma.Decimal; total: Prisma.Decimal; items: { quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }[] }>(bill: T, conflict?: string) {
    if (conflict) throw new ConflictException(conflict);
    const baseUrl = this.config.getOrThrow<string>("FRONTEND_URL").replace(/\/$/, "");
    return { ...this.serializeBill(bill), paymentUrl: `${baseUrl}/pay/${bill.publicToken}` };
  }

  private hashRequest(dto: CreateBillDto, taxRate: Prisma.Decimal) {
    const normalized = {
      currency: dto.currency,
      taxRate: taxRate.toString(),
      description: dto.description?.trim() || null,
      customerName: dto.customerName?.trim() || null,
      customerEmail: dto.customerEmail?.trim().toLowerCase() || null,
      items: dto.items.map((item) => ({ description: item.description.trim(), quantity: new Prisma.Decimal(item.quantity).toString(), unitPrice: new Prisma.Decimal(item.unitPrice).toString() })),
    };
    return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  }
}
