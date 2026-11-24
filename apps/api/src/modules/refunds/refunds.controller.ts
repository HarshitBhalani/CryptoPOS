import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MerchantAccessGuard } from "../bills/merchant-access.guard";
import { MerchantOwnerGuard } from "../merchants/merchant-owner.guard";
import { RefundsService } from "./refunds.service";
import { RequestRefundDto } from "./dto/request-refund.dto";
import { RejectRefundDto } from "./dto/reject-refund.dto";
import { SubmitRefundDto } from "./dto/submit-refund.dto";
import { ListRefundsQueryDto } from "./dto/list-refunds-query.dto";

@Controller("merchants/:merchantId/refunds")
@UseGuards(JwtAuthGuard, MerchantAccessGuard)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}

  @Post()
  async requestRefund(
    @Param("merchantId") merchantId: string,
    @Body() body: RequestRefundDto,
    @Headers("idempotency-key") idempotencyKey: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    if (!idempotencyKey || idempotencyKey.trim().length < 16) {
      throw new BadRequestException("Idempotency-Key header of at least 16 characters is required.");
    }

    return {
      success: true,
      message: "Refund requested",
      data: {
        refund: await this.refunds.requestRefund(
          merchantId,
          user.id,
          body,
          idempotencyKey.trim()
        ),
      },
    };
  }

  @Get()
  async listRefunds(
    @Param("merchantId") merchantId: string,
    @Query() query: ListRefundsQueryDto
  ) {
    return {
      success: true,
      message: "Refunds list retrieved",
      data: await this.refunds.listRefundsForMerchant(merchantId, query),
    };
  }

  @Get("summary/:billId")
  async getBillRefundSummary(
    @Param("merchantId") merchantId: string,
    @Param("billId") billId: string
  ) {
    return {
      success: true,
      message: "Refundable summary retrieved",
      data: await this.refunds.getRefundableSummaryForBill(merchantId, billId),
    };
  }

  @Get(":refundId")
  async getRefund(
    @Param("merchantId") merchantId: string,
    @Param("refundId") refundId: string
  ) {
    return {
      success: true,
      message: "Refund details retrieved",
      data: { refund: await this.refunds.getRefundDetail(merchantId, refundId) },
    };
  }

  @Post(":refundId/approve")
  @UseGuards(MerchantOwnerGuard)
  async approveRefund(
    @Param("merchantId") merchantId: string,
    @Param("refundId") refundId: string,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return {
      success: true,
      message: "Refund approved for wallet signing",
      data: await this.refunds.approveRefund(merchantId, refundId, user.id),
    };
  }

  @Post(":refundId/reject")
  @UseGuards(MerchantOwnerGuard)
  async rejectRefund(
    @Param("merchantId") merchantId: string,
    @Param("refundId") refundId: string,
    @Body() body: RejectRefundDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return {
      success: true,
      message: "Refund rejected",
      data: {
        refund: await this.refunds.rejectRefund(
          merchantId,
          refundId,
          user.id,
          body.reason
        ),
      },
    };
  }

  @Post(":refundId/submit")
  @UseGuards(MerchantOwnerGuard)
  async submitRefund(
    @Param("merchantId") merchantId: string,
    @Param("refundId") refundId: string,
    @Body() body: SubmitRefundDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return {
      success: true,
      message: "Refund submitted and pending verification",
      data: {
        refund: await this.refunds.submitRefund(
          merchantId,
          refundId,
          user.id,
          body.signature
        ),
      },
    };
  }

  @Post(":refundId/verify")
  async verifyRefund(
    @Param("merchantId") merchantId: string,
    @Param("refundId") refundId: string
  ) {
    return {
      success: true,
      message: "Refund verification processed",
      data: await this.refunds.verifyRefundById(merchantId, refundId),
    };
  }
}
