import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from "@nestjs/common";
import { PaymentsService } from "./payments.service";
import { SubmitPaymentDto } from "./dto/submit-payment.dto";

@Controller("public/pay/:paymentToken")
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  /**
   * POST /api/v1/public/pay/:paymentToken/submit
   * Submit a signed USDC payment transaction (customer-facing, no auth).
   */
  @Post("submit")
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @Param("paymentToken") paymentToken: string,
    @Body() dto: SubmitPaymentDto,
  ) {
    const attempt = await this.service.submitPayment(paymentToken, dto);
    return { data: { attempt } };
  }

  /**
   * GET /api/v1/public/pay/:paymentToken/attempt/:quoteId
   * Poll payment attempt status (public, used by customer UI).
   */
  @Get("attempt/:quoteId")
  async getAttempt(
    @Param("paymentToken") paymentToken: string,
    @Param("quoteId") quoteId: string,
  ) {
    const attempt = await this.service.getAttemptByQuote(paymentToken, quoteId);
    return { data: { attempt } };
  }
}
