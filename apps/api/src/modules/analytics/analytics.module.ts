import { Module } from "@nestjs/common";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { AuthModule } from "../auth/auth.module";
import { BillsModule } from "../bills/bills.module";

@Module({
  imports: [AuthModule, BillsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
