import { Module } from "@nestjs/common";
import { IndexerService } from "./indexer.service";
import { PrismaService } from "../prisma.service";
import { RedisService } from "../redis.service";
import { LedgerModule } from "../ledger/ledger.module";
import { RefundsModule } from "../refunds/refunds.module";

@Module({
  imports: [LedgerModule, RefundsModule],
  providers: [IndexerService, PrismaService, RedisService],
  exports: [IndexerService],
})
export class IndexerModule {}
