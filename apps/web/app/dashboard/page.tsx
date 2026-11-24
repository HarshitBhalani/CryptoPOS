"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiData } from "../../lib/api";
import { useDashboard } from "./dashboard-context";

type Bill = { id: string; number: string; total: string; currency: string; status: string; createdAt: string };

export default function DashboardPage() {
  const { user, merchant } = useDashboard();
  const [bills, setBills] = useState<Bill[]>([]);
  const [total, setTotal] = useState(0);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  useEffect(() => {
    Promise.all([
      apiData<{ bills: Bill[] }>(`/merchants/${merchant.id}/bills?page=1&pageSize=5`),
      apiData<{ total: number; byStatus: Record<string, number> }>(`/merchants/${merchant.id}/bills/summary`),
    ]).then(([recent, summary]) => { setBills(recent.bills); setTotal(summary.total); setByStatus(summary.byStatus); })
      .catch(() => { setBills([]); setTotal(0); setByStatus({}); });
  }, [merchant.id]);
  const openCount = byStatus.OPEN ?? 0;
  const paidCount = byStatus.PAID ?? 0;
  return <>
    <div className="page-heading"><div><p className="eyebrow">OVERVIEW</p><h1>Good to see you, {user.name.split(" ")[0]}</h1><p className="muted">Here’s what’s happening at {merchant.name}.</p></div><Link className="button" href="/dashboard/pos">Create bill</Link></div>
    <div className="metric-grid"><article className="metric-card"><span>Total bills</span><strong>{total}</strong></article><article className="metric-card"><span>Open bills</span><strong>{openCount}</strong></article><article className="metric-card"><span>Paid bills</span><strong>{paidCount}</strong></article></div>
    <section className="panel"><div className="panel-heading"><div><h2>Recent bills</h2><p className="muted">Latest saved bills for this business.</p></div><Link className="text-link" href="/dashboard/bills">All bills</Link></div>
      {bills.length ? <div className="table-wrap"><table><thead><tr><th>Bill</th><th>Date</th><th>Status</th><th className="align-right">Amount</th></tr></thead><tbody>{bills.map((bill) => <tr key={bill.id}><td><Link className="table-link" href={`/dashboard/bills/${bill.id}`}>{bill.number}</Link></td><td>{new Date(bill.createdAt).toLocaleDateString()}</td><td><span className={`status status-${bill.status.toLowerCase()}`}>{bill.status.toLowerCase().replaceAll("_", " ")}</span></td><td className="align-right">{bill.currency} {bill.total}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon">＋</span><h3>No bills yet</h3><p>Create a bill at the POS and it will appear here.</p><Link className="button" href="/dashboard/pos">Go to POS</Link></div>}
    </section>
  </>;
}
