import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../auth/auth.module";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { BillsController, PublicBillsController } from "./bills.controller";
import { BillsService } from "./bills.service";
import { MerchantAccessGuard } from "./merchant-access.guard";
import { QuotesService } from "../quotes/quotes.service";
import { PriceProvider } from "../quotes/price-provider";

@Module({ imports: [AuthModule, JwtModule.register({})], controllers: [BillsController, PublicBillsController], providers: [JwtAuthGuard, BillsService, MerchantAccessGuard, QuotesService, PriceProvider] })
export class BillsModule {}
