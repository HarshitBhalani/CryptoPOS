"use client";

import { FormEvent, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiData } from "../../../lib/api";
import { useDashboard } from "../dashboard-context";

type Item = { description: string; quantity: string; unitPrice: string };
type Bill = { id: string; number: string; subtotal: string; taxAmount: string; total: string; currency: string; status: string; paymentUrl: string };
const newItem = (): Item => ({ description: "", quantity: "1", unitPrice: "" });

export default function PosPage() {
  const { merchant } = useDashboard();
  const [items, setItems] = useState<Item[]>([newItem()]);
  const [currency, setCurrency] = useState("USD");
  const [taxRate, setTaxRate] = useState("0");
  const [description, setDescription] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  function updateItem(index: number, field: keyof Item, value: string) {
    setItems((current) => current.map((item, position) => position === index ? { ...item, [field]: value } : item));
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const result = await apiData<{ bill: Bill }>(`/merchants/${merchant.id}/bills`, {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey.current },
        body: JSON.stringify({ currency, taxRate, description, customerName, customerEmail, items }),
      });
      setBill(result.bill);
      idempotencyKey.current = null;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create bill");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="page-heading"><div><p className="eyebrow">POINT OF SALE</p><h1>New bill</h1><p className="muted">Create a bill for {merchant.name}. Totals are calculated by the server.</p></div></div>
    <div className="pos-layout">
      <form className="panel pos-form" onSubmit={create}>
        <div className="form-section-heading"><div><h2>Bill details</h2><p className="muted">Choose currency and add the items.</p></div></div>
        <div className="form-grid">
          <label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>USD</option><option>AUD</option><option>CAD</option><option>EUR</option><option>GBP</option><option>INR</option></select></label>
          <label>Tax rate (%)<input value={taxRate} onChange={(event) => setTaxRate(event.target.value)} inputMode="decimal" placeholder="0" pattern="\d{1,3}(\.\d{1,4})?" /></label>
          <label className="span-two">Bill description <span className="optional">Optional</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="What is this bill for?" /></label>
          <label>Customer name <span className="optional">Optional</span><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={100} /></label>
          <label>Customer email <span className="optional">Optional</span><input value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} type="email" maxLength={254} /></label>
        </div>
        <div className="items-heading"><div><h2>Line items</h2><p className="muted">Enter quantity and unit price in {currency}.</p></div><button type="button" className="secondary-button" onClick={() => setItems((current) => [...current, newItem()])} disabled={items.length >= 100}>＋ Add item</button></div>
        <div className="line-items">{items.map((item, index) => <div className="line-item" key={index}>
          <label className="item-description">Item description<input required value={item.description} onChange={(event) => updateItem(index, "description", event.target.value)} maxLength={160} placeholder="Product or service" /></label>
          <label>Qty<input required type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,6})?" value={item.quantity} onChange={(event) => updateItem(index, "quantity", event.target.value)} /></label>
          <label>Unit price<input required type="text" inputMode="decimal" pattern="\d{1,12}(\.\d{1,6})?" value={item.unitPrice} onChange={(event) => updateItem(index, "unitPrice", event.target.value)} placeholder="0.00" /></label>
          <button type="button" className="remove-item" aria-label="Remove item" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, position) => position !== index))}>×</button>
        </div>)}</div>
        <div className="server-total-note">Subtotal, tax and final total are calculated and rounded on the backend.</div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button form-button create-bill-button" disabled={busy}>{busy ? "Saving bill…" : "Create bill"}</button>
      </form>
      <aside className="pos-aside"><div className="panel safety-panel"><span className="aside-icon">↗</span><h3>Direct to the merchant</h3><p>CryptoPOS never holds customer funds. Wallet payments will be enabled in a later phase.</p></div>
        {bill && <div className="panel receipt-panel"><p className="eyebrow">BILL CREATED</p><h2>{bill.number}</h2><div className="receipt-total"><span>Total</span><strong>{bill.currency} {bill.total}</strong></div><div className="receipt-breakdown"><div><span>Subtotal</span><span>{bill.currency} {bill.subtotal}</span></div><div><span>Tax</span><span>{bill.currency} {bill.taxAmount}</span></div></div><div className="qr-wrap"><QRCodeSVG value={bill.paymentUrl} size={176} level="M" includeMargin /></div><p className="qr-caption">Scan to view this bill</p><a className="payment-url" href={bill.paymentUrl} target="_blank" rel="noreferrer">{bill.paymentUrl}</a></div>}
      </aside>
    </div>
  </>;
}
