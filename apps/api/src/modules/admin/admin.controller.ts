import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { AdminService } from "./admin.service";
import { ListAuditLogsQueryDto } from "./dto/list-audit-logs-query.dto";
import { ListMerchantsQueryDto } from "./dto/list-merchants-query.dto";
import { UpdateMerchantStatusDto } from "./dto/update-merchant-status.dto";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLATFORM_ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  async getOverview() {
    return {
      success: true,
      message: "Platform admin overview retrieved",
      data: await this.admin.getPlatformOverview(),
    };
  }

  @Get("merchants")
  async listMerchants(@Query() query: ListMerchantsQueryDto) {
    return {
      success: true,
      message: "Merchants list retrieved",
      data: await this.admin.listMerchants(query),
    };
  }

  @Get("merchants/:merchantId")
  async getMerchantDetails(@Param("merchantId") merchantId: string) {
    return {
      success: true,
      message: "Merchant details retrieved",
      data: await this.admin.getMerchantDetails(merchantId),
    };
  }

  @Patch("merchants/:merchantId/status")
  async updateMerchantStatus(
    @Param("merchantId") merchantId: string,
    @Body() body: UpdateMerchantStatusDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    const result = await this.admin.updateMerchantStatus(
      user.id,
      merchantId,
      body
    );
    return {
      success: true,
      message: `Merchant status updated to ${body.status}`,
      data: result,
    };
  }

  @Get("audit-logs")
  async listAuditLogs(@Query() query: ListAuditLogsQueryDto) {
    return {
      success: true,
      message: "Admin audit logs retrieved",
      data: await this.admin.listAuditLogs(query),
    };
  }

  @Get("ledger/reconciliation")
  async getLedgerReconciliation() {
    return {
      success: true,
      message: "Ledger reconciliation report retrieved",
      data: await this.admin.getLedgerReconciliation(),
    };
  }
}
