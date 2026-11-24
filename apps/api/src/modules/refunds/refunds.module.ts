import { Module } from "@nestjs/common";
import { RefundsService } from "./refunds.service";
import { RefundsController } from "./refunds.controller";
import { PrismaService } from "../prisma.service";
import { LedgerModule } from "../ledger/ledger.module";
import { AuthModule } from "../auth/auth.module";
import { BillsModule } from "../bills/bills.module";
import { MerchantsModule } from "../merchants/merchants.module";

@Module({
  imports: [AuthModule, BillsModule, MerchantsModule, LedgerModule],
  controllers: [RefundsController],
  providers: [RefundsService, PrismaService],
  exports: [RefundsService],
})
export class RefundsModule {}
