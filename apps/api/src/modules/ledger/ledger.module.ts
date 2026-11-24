import { Module } from "@nestjs/common";
import { LedgerService } from "./ledger.service";
import { LedgerController } from "./ledger.controller";
import { PrismaService } from "../prisma.service";
import { AuthModule } from "../auth/auth.module";
import { BillsModule } from "../bills/bills.module";

@Module({
  imports: [AuthModule, BillsModule],
  controllers: [LedgerController],
  providers: [LedgerService, PrismaService],
  exports: [LedgerService],
})
export class LedgerModule {}
