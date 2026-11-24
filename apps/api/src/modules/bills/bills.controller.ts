import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MerchantAccessGuard } from "./merchant-access.guard";
import { BillsService } from "./bills.service";
import { CreateBillDto } from "./dto/create-bill.dto";
import { ListBillsQueryDto } from "./dto/list-bills-query.dto";
import { QuotesService } from "../quotes/quotes.service";

@Controller("merchants/:merchantId/bills")
@UseGuards(JwtAuthGuard, MerchantAccessGuard)
export class BillsController {
  constructor(private readonly bills: BillsService, private readonly quotes: QuotesService) {}

  @Post()
  async create(@Param("merchantId") merchantId: string, @Body() body: CreateBillDto, @Headers("idempotency-key") idempotencyKey: string, @CurrentUser() _user: AuthenticatedUser) {
    return { success: true, message: "Bill created", data: { bill: await this.bills.create(merchantId, body, idempotencyKey) } };
  }

  @Get()
  async list(@Param("merchantId") merchantId: string, @Query() query: ListBillsQueryDto) {
    return { success: true, message: "Bills", data: await this.bills.list(merchantId, query) };
  }

  @Get("summary")
  async summary(@Param("merchantId") merchantId: string) {
    return { success: true, message: "Bill summary", data: await this.bills.summary(merchantId) };
  }

  @Get("review")
  async listForReview(@Param("merchantId") merchantId: string) {
    return { success: true, message: "Bills requiring review", data: await this.bills.listPaymentsForReview(merchantId) };
  }

  @Get(":billId/payments")
  async paymentsForBill(@Param("merchantId") merchantId: string, @Param("billId") billId: string) {
    return { success: true, message: "Bill payment history", data: await this.bills.getPaymentsForBill(merchantId, billId) };
  }

  @Get(":billId/quotes")
  async quotesForBill(@Param("merchantId") merchantId: string, @Param("billId") billId: string) {
    return { success: true, message: "Bill quote history", data: await this.quotes.listForMerchant(merchantId, billId) };
  }

  @Get(":billId")
  async get(@Param("merchantId") merchantId: string, @Param("billId") billId: string) {
    return { success: true, message: "Bill details", data: { bill: await this.bills.get(merchantId, billId) } };
  }

  @Post(":billId/cancel")
  async cancel(@Param("merchantId") merchantId: string, @Param("billId") billId: string) {
    return { success: true, message: "Bill cancelled", data: { bill: await this.bills.cancel(merchantId, billId) } };
  }
}

@Controller("public/pay")
export class PublicBillsController {
  constructor(private readonly bills: BillsService, private readonly quotes: QuotesService) {}

  @Get(":paymentToken")
  async get(@Param("paymentToken") paymentToken: string) {
    return { success: true, message: "Public bill", data: { bill: await this.bills.getPublic(paymentToken) } };
  }

  @Post(":paymentToken/quotes")
  async createQuote(@Param("paymentToken") paymentToken: string) {
    return { success: true, message: "USDC quote created", data: { quote: await this.quotes.createPublic(paymentToken) } };
  }
}
