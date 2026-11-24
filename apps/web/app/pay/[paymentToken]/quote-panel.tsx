"use client";

import { CustomerPaymentFlow, Quote } from "./customer-payment-flow";

export type { Quote };

export function QuotePanel({ paymentToken }: { paymentToken: string }) {
  return (
    <CustomerPaymentFlow
      paymentToken={paymentToken}
      merchantName="Merchant"
      merchantSettlementAddress={null}
      isSettlementConfigured={false}
      currency="USD"
      total="0.00"
    />
  );
}
