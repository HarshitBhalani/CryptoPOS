import {
  Body,
  Controller,
  Get,
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
import { LedgerService } from "./ledger.service";
import { ListJournalsQueryDto } from "./dto/list-journals-query.dto";
import { ReverseJournalDto } from "./dto/reverse-journal.dto";

@Controller("merchants/:merchantId/ledger")
@UseGuards(JwtAuthGuard, MerchantAccessGuard)
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get("journals")
  async listJournals(
    @Param("merchantId") merchantId: string,
    @Query() query: ListJournalsQueryDto
  ) {
    return {
      success: true,
      message: "Ledger journals retrieved",
      data: await this.ledger.listJournalsForMerchant(merchantId, query),
    };
  }

  @Get("journals/:journalId")
  async getJournal(
    @Param("merchantId") merchantId: string,
    @Param("journalId") journalId: string
  ) {
    return {
      success: true,
      message: "Ledger journal detail retrieved",
      data: { journal: await this.ledger.getJournalDetail(merchantId, journalId) },
    };
  }

  @Post("journals/:journalId/reverse")
  @UseGuards(MerchantOwnerGuard)
  async reverseJournal(
    @Param("merchantId") merchantId: string,
    @Param("journalId") journalId: string,
    @Body() body: ReverseJournalDto,
    @CurrentUser() user: AuthenticatedUser
  ) {
    return {
      success: true,
      message: "Ledger journal reversed",
      data: {
        journal: await this.ledger.reverseJournal(
          merchantId,
          journalId,
          body.reason,
          user.id
        ),
      },
    };
  }

  @Get("accounts")
  async listAccounts(@Param("merchantId") merchantId: string) {
    return {
      success: true,
      message: "Ledger accounts retrieved",
      data: await this.ledger.listAccountsForMerchant(merchantId),
    };
  }

  @Get("reconciliation")
  async getReconciliation(@Param("merchantId") merchantId: string) {
    return {
      success: true,
      message: "Reconciliation report retrieved",
      data: await this.ledger.getReconciliationReport(merchantId),
    };
  }
}
