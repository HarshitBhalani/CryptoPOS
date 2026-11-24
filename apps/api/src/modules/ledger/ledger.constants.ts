import { LedgerAccountType } from "@prisma/client";

export const LEDGER_CODE_MERCHANT_SETTLEMENT = "1110_USDC_MERCHANT_SETTLEMENT" as const;
export const LEDGER_CODE_MERCHANT_SALES = "4100_MERCHANT_SALES" as const;
export const LEDGER_CODE_PLATFORM_FEE_RECEIVABLE = "1120_USDC_PLATFORM_FEE" as const;
export const LEDGER_CODE_PLATFORM_FEE_REVENUE = "4200_PLATFORM_FEE_REVENUE" as const;
export const LEDGER_CODE_CUSTOMER_SUSPENSE = "2110_CUSTOMER_PREPAYMENT" as const;

export interface StandardAccountDef {
  code: string;
  name: string;
  type: LedgerAccountType;
  isPlatformScoped: boolean;
}

export const CHART_OF_ACCOUNTS: Record<string, StandardAccountDef> = {
  [LEDGER_CODE_MERCHANT_SETTLEMENT]: {
    code: LEDGER_CODE_MERCHANT_SETTLEMENT,
    name: "Merchant USDC Settlement (Direct Wallet)",
    type: LedgerAccountType.ASSET,
    isPlatformScoped: false,
  },
  [LEDGER_CODE_MERCHANT_SALES]: {
    code: LEDGER_CODE_MERCHANT_SALES,
    name: "Merchant Sales Revenue (USDC)",
    type: LedgerAccountType.REVENUE,
    isPlatformScoped: false,
  },
  [LEDGER_CODE_PLATFORM_FEE_RECEIVABLE]: {
    code: LEDGER_CODE_PLATFORM_FEE_RECEIVABLE,
    name: "Platform Fee Direct Receivable (USDC)",
    type: LedgerAccountType.ASSET,
    isPlatformScoped: true,
  },
  [LEDGER_CODE_PLATFORM_FEE_REVENUE]: {
    code: LEDGER_CODE_PLATFORM_FEE_REVENUE,
    name: "Platform Fee Revenue (USDC)",
    type: LedgerAccountType.REVENUE,
    isPlatformScoped: true,
  },
  [LEDGER_CODE_CUSTOMER_SUSPENSE]: {
    code: LEDGER_CODE_CUSTOMER_SUSPENSE,
    name: "Customer Prepayment / Suspense (USDC)",
    type: LedgerAccountType.LIABILITY,
    isPlatformScoped: false,
  },
};
