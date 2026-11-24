import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../auth/auth.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MerchantSettingsController, MerchantWalletController, MerchantsController } from "./merchants.controller";
import { MerchantOwnerGuard } from "./merchant-owner.guard";
import { MerchantsService } from "./merchants.service";

@Module({
  imports: [AuthModule, JwtModule.register({})],
  controllers: [MerchantsController, MerchantWalletController, MerchantSettingsController],
  providers: [JwtAuthGuard, MerchantsService, MerchantOwnerGuard],
})
export class MerchantsModule {}
