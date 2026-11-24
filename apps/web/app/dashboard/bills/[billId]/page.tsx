"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { apiData } from "../../../../lib/api";
import { useDashboard } from "../../dashboard-context";
import { RefundSection } from "./refund-section";

type Bill = { id: string; number: string; description?: string | null; customerName?: string | null; customerEmail?: string | null; currency: string; subtotal: string; taxRate: string; taxAmount: string; total: string; status: string; createdAt: string; paymentUrl: string; items: { id: string; description: string; quantity: string; unitPrice: string; lineTotal: string }[] };

export default function BillDetailPage() {
  const params = useParams<{ billId: string }>();
  const router = useRouter();
  const { merchant, user } = useDashboard();
  const isOwner = merchant.role === "OWNER" || user.role === "PLATFORM_ADMIN";
  const [bill, setBill] = useState<Bill | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiData<{ bill: Bill }>(`/merchants/${merchant.id}/bills/${params.billId}`).then(({ bill: value }) => setBill(value)).catch((reason) => setError(reason.message));
  }, [merchant.id, params.billId]);

  async function cancelBill() {
    if (!bill || !window.confirm(`Cancel ${bill.number}? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      const result = await apiData<{ bill: Bill }>(`/merchants/${merchant.id}/bills/${bill.id}/cancel`, { method: "POST" });
      setBill(result.bill);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not cancel bill"); }
    finally { setBusy(false); }
  }

  if (error && !bill) return <section className="panel"><p className="form-error">{error}</p><Link className="text-link" href="/dashboard/bills">Back to bills</Link></section>;
  if (!bill) return <div className="dashboard-loading"><span className="spinner" />Loading bill…</div>;
  return <>
    <div className="breadcrumb"><Link href="/dashboard/bills">Bills</Link><span>/</span>{bill.number}</div>
    <div className="page-heading"><div><p className="eyebrow">BILL DETAILS</p><h1>{bill.number}</h1><p className="muted">Created {new Date(bill.createdAt).toLocaleString()}</p></div><span className={`status status-${bill.status.toLowerCase()}`}>{bill.status.toLowerCase().replaceAll("_", " ")}</span></div>
    {error && <p className="form-error">{error}</p>}
    <div className="detail-grid"><section className="panel"><h2>Items</h2>{bill.description && <p className="muted">{bill.description}</p>}<div className="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th className="align-right">Unit price</th><th className="align-right">Line total</th></tr></thead><tbody>{bill.items.map((item) => <tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td className="align-right">{bill.currency} {item.unitPrice}</td><td className="align-right">{bill.currency} {item.lineTotal}</td></tr>)}</tbody></table></div><div className="totals"><div><span>Subtotal</span><span>{bill.currency} {bill.subtotal}</span></div><div><span>Tax ({bill.taxRate}%)</span><span>{bill.currency} {bill.taxAmount}</span></div><div className="grand-total"><strong>Total</strong><strong>{bill.currency} {bill.total}</strong></div></div>
      <div className="customer-block"><h3>Customer</h3><p>{bill.customerName || "No name provided"}</p><p>{bill.customerEmail || "No email provided"}</p></div>
      {bill.status === "OPEN" && <button className="danger-button" onClick={cancelBill} disabled={busy}>{busy ? "Cancelling…" : "Cancel unpaid bill"}</button>}
    </section><aside className="panel share-panel"><h2>Bill link</h2><p className="muted">Share this link to show the customer the bill.</p><div className="qr-wrap"><QRCodeSVG value={bill.paymentUrl} size={176} level="M" includeMargin /></div><a className="payment-url" href={bill.paymentUrl} target="_blank" rel="noreferrer">{bill.paymentUrl}</a><button className="secondary-button" onClick={() => navigator.clipboard.writeText(bill.paymentUrl)}>Copy link</button></aside></div>
    <RefundSection billId={bill.id} merchantId={merchant.id} isOwner={isOwner} />
  </>;
}
