import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MerchantAccessGuard } from "../bills/merchant-access.guard";
import { AnalyticsService } from "./analytics.service";
import { MerchantAnalyticsQueryDto } from "./dto/merchant-analytics-query.dto";

@Controller("merchants/:merchantId/analytics")
@UseGuards(JwtAuthGuard, MerchantAccessGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("overview")
  async getOverview(
    @Param("merchantId") merchantId: string,
    @Query() query: MerchantAnalyticsQueryDto
  ) {
    const data = await this.analytics.getMerchantOverview(merchantId, query);
    return {
      success: true,
      message: "Merchant analytics overview retrieved",
      data,
    };
  }

  @Get("series")
  async getTimeSeries(
    @Param("merchantId") merchantId: string,
    @Query() query: MerchantAnalyticsQueryDto
  ) {
    const data = await this.analytics.getMerchantTimeSeries(merchantId, query);
    return {
      success: true,
      message: "Merchant analytics time series retrieved",
      data,
    };
  }
}
