import Link from "next/link";
import { CustomerPaymentFlow } from "./customer-payment-flow";

const API = `${process.env.API_INTERNAL_URL ?? "http://localhost:4000"}/api/v1`;

type PublicBill = {
  number: string;
  description?: string | null;
  currency: string;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  status: string;
  merchant: {
    name: string;
    settlementAddress?: string | null;
  };
  network?: string;
  supportedToken?: {
    symbol: string;
    name: string;
    mint: string;
    decimals: number;
    network: string;
  };
  isSettlementConfigured?: boolean;
  items: { description: string; quantity: string; unitPrice: string; lineTotal: string }[];
};

export default async function PublicBillPage({ params }: { params: Promise<{ paymentToken: string }> }) {
  const { paymentToken } = await params;
  const response = await fetch(`${API}/public/pay/${encodeURIComponent(paymentToken)}`, { cache: "no-store" });
  if (!response.ok) {
    return (
      <main className="public-shell">
        <section className="public-card">
          <p className="eyebrow">CRYPTOPOS</p>
          <h1>Bill link unavailable</h1>
          <p className="muted">This bill link is invalid or no longer available.</p>
          <Link className="text-link" href="/">
            Return to CryptoPOS
          </Link>
        </section>
      </main>
    );
  }

  const result = await response.json();
  const bill = result.data.bill as PublicBill;

  return (
    <main className="public-shell">
      <section className="public-card">
        <div className="bill-top-badge">
          <p className="eyebrow">PAYMENT REQUEST</p>
          <span className={`status status-${bill.status.toLowerCase()}`}>{bill.status}</span>
        </div>

        <h1>{bill.merchant.name}</h1>
        <p className="muted">
          Bill {bill.number}
          {bill.description ? ` · ${bill.description}` : ""}
        </p>

        <div className="public-items">
          {bill.items.map((item, index) => (
            <div key={`${item.description}-${index}`}>
              <span>
                {item.description} × {item.quantity}
              </span>
              <span>
                {bill.currency} {item.lineTotal}
              </span>
            </div>
          ))}
        </div>

        <div className="totals">
          <div>
            <span>Subtotal</span>
            <span>
              {bill.currency} {bill.subtotal}
            </span>
          </div>
          <div>
            <span>Tax ({bill.taxRate}%)</span>
            <span>
              {bill.currency} {bill.taxAmount}
            </span>
          </div>
          <div className="grand-total">
            <strong>Total due</strong>
            <strong>
              {bill.currency} {bill.total}
            </strong>
          </div>
        </div>

        {bill.status === "OPEN" ? (
          <CustomerPaymentFlow
            paymentToken={paymentToken}
            merchantName={bill.merchant.name}
            merchantSettlementAddress={bill.merchant.settlementAddress ?? null}
            isSettlementConfigured={Boolean(bill.isSettlementConfigured)}
            currency={bill.currency}
            total={bill.total}
          />
        ) : (
          <div className="coming-soon">
            <strong>Bill status: {bill.status.toLowerCase().replaceAll("_", " ")}</strong>
            <span>Contact {bill.merchant.name} if you need help with this bill.</span>
          </div>
        )}

        <div className="public-footer-card">
          <span>Non-custodial merchant settlement · Solana Devnet</span>
          <span className="footer-token-info">Circle USDC · 6 Decimals · Verified Devnet Mint</span>
        </div>
      </section>
    </main>
  );
}
