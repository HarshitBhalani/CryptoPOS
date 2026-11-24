"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiData } from "../../../lib/api";
import { useDashboard } from "../dashboard-context";

type Bill = { id: string; number: string; currency: string; total: string; status: string; customerName?: string | null; createdAt: string };
type BillPage = { bills: Bill[]; total: number; page: number; pageSize: number };

export default function BillsPage() {
  const { merchant } = useDashboard();
  const [page, setPage] = useState<BillPage>({ bills: [], total: 0, page: 1, pageSize: 20 });
  const [pageNumber, setPageNumber] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const params = new URLSearchParams({ page: String(pageNumber), pageSize: "20" });
    if (status) params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    apiData<BillPage>(`/merchants/${merchant.id}/bills?${params}`).then(setPage).catch((reason) => setError(reason.message));
  }, [merchant.id, status, search, pageNumber]);
  const pageCount = Math.max(1, Math.ceil(page.total / page.pageSize));
  return <>
    <div className="page-heading"><div><p className="eyebrow">BILL MANAGEMENT</p><h1>Bills</h1><p className="muted">{page.total} bill{page.total === 1 ? "" : "s"} for {merchant.name}.</p></div><Link className="button" href="/dashboard/pos">Create bill</Link></div>
    <section className="panel">
      <div className="filters"><input aria-label="Search bills" placeholder="Search bill, customer…" value={search} onChange={(event) => { setSearch(event.target.value); setPageNumber(1); }} /><select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPageNumber(1); }}><option value="">All statuses</option>{["DRAFT", "OPEN", "PENDING", "PAID", "CANCELLED", "EXPIRED", "PARTIALLY_PAID", "OVERPAID", "PAYMENT_REVIEW"].map((value) => <option key={value}>{value}</option>)}</select></div>
      {error && <p className="form-error">{error}</p>}
      {page.bills.length ? <><div className="table-wrap"><table><thead><tr><th>Bill</th><th>Customer</th><th>Created</th><th>Status</th><th className="align-right">Amount</th></tr></thead><tbody>{page.bills.map((bill) => <tr key={bill.id}><td><Link className="table-link" href={`/dashboard/bills/${bill.id}`}>{bill.number}</Link></td><td>{bill.customerName || "—"}</td><td>{new Date(bill.createdAt).toLocaleString()}</td><td><span className={`status status-${bill.status.toLowerCase()}`}>{bill.status.toLowerCase().replaceAll("_", " ")}</span></td><td className="align-right">{bill.currency} {bill.total}</td></tr>)}</tbody></table></div><div className="pagination"><span>Page {pageNumber} of {pageCount}</span><div><button className="secondary-button" disabled={pageNumber <= 1} onClick={() => setPageNumber((value) => value - 1)}>Previous</button><button className="secondary-button" disabled={pageNumber >= pageCount} onClick={() => setPageNumber((value) => value + 1)}>Next</button></div></div></> : <div className="empty-state"><span className="empty-icon">▤</span><h3>No matching bills</h3><p>Create a bill or adjust your filters.</p></div>}
    </section>
  </>;
}
