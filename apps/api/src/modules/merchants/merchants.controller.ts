import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AddMemberDto } from "./dto/add-member.dto";
import { MerchantOwnerGuard } from "./merchant-owner.guard";
import { MerchantsService } from "./merchants.service";
import { UpdateMerchantSettingsDto } from "./dto/update-merchant-settings.dto";
import { UpdateMerchantWalletDto } from "./dto/update-merchant-wallet.dto";

@Controller("merchants/:merchantId/members")
@UseGuards(JwtAuthGuard, MerchantOwnerGuard)
export class MerchantsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  async list(@Param("merchantId") merchantId: string) {
    return { success: true, message: "Merchant staff", data: { members: await this.merchants.listMembers(merchantId) } };
  }

  @Post()
  async add(@Param("merchantId") merchantId: string, @Body() body: AddMemberDto, @CurrentUser() user: AuthenticatedUser) {
    return { success: true, message: "Cashier added", data: { member: await this.merchants.addCashier(merchantId, body.email, user.id) } };
  }
}

@Controller("merchants/:merchantId/wallet")
@UseGuards(JwtAuthGuard, MerchantOwnerGuard)
export class MerchantWalletController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  async getWallet(@Param("merchantId") merchantId: string) {
    return {
      success: true,
      message: "Merchant settlement wallet",
      data: { wallet: await this.merchants.getWallet(merchantId) },
    };
  }

  @Put()
  async updateWallet(@Param("merchantId") merchantId: string, @Body() body: UpdateMerchantWalletDto) {
    return {
      success: true,
      message: "Merchant settlement wallet updated",
      data: { wallet: await this.merchants.updateWallet(merchantId, body.settlementAddress) },
    };
  }

  @Delete()
  async removeWallet(@Param("merchantId") merchantId: string) {
    return {
      success: true,
      message: "Merchant settlement wallet removed",
      data: { wallet: await this.merchants.removeWallet(merchantId) },
    };
  }
}

@Controller("merchants/:merchantId")
@UseGuards(JwtAuthGuard, MerchantOwnerGuard)
export class MerchantSettingsController {
  constructor(private readonly merchants: MerchantsService) {}

  @Get()
  async getSettings(@Param("merchantId") merchantId: string) {
    return { success: true, message: "Business settings", data: { merchant: await this.merchants.getSettings(merchantId) } };
  }

  @Patch()
  async updateSettings(@Param("merchantId") merchantId: string, @Body() body: UpdateMerchantSettingsDto) {
    return { success: true, message: "Business settings updated", data: { merchant: await this.merchants.updateSettings(merchantId, body) } };
  }
}
