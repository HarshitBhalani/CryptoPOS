"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiData, apiFetch } from "../../lib/api";

interface PlatformOverview {
  network: string;
  token: { symbol: string; mint: string; decimals: number };
  merchants: { total: number; active: number; suspended: number };
  bills: { total: number; byStatus: Record<string, number> };
  financialTotals: {
    grossVolumeUnits: string;
    grossVolumeFormatted: string;
    refundVolumeUnits: string;
    refundVolumeFormatted: string;
    netVolumeUnits: string;
    netVolumeFormatted: string;
    feeVolumeUnits: string;
    feeVolumeFormatted: string;
    confirmedTransactionCount: number;
    confirmedRefundCount: number;
  };
  ledger: { postedJournalsCount: number };
  indexer: {
    status: string;
    lastSlot: string;
    lastSignature: string | null;
    updatedAt: string | null;
  };
}

interface MerchantItem {
  id: string;
  name: string;
  businessType: string | null;
  status: "ACTIVE" | "SUSPENDED";
  settlementAddress: string | null;
  createdAt: string;
  owner: { id: string; name: string; email: string } | null;
  paidBillsCount: number;
  confirmedVolumeFormatted: string;
}

interface AuditLogItem {
  id: string;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: any;
  createdAt: string;
}

interface ReconciliationReport {
  isSystemBalanced: boolean;
  totalJournalsAudited: number;
  systemTotalDebitFormatted: string;
  systemTotalCreditFormatted: string;
  imbalancedCount: number;
  imbalancedJournals: any[];
}

export default function AdminPage() {
  const [tab, setTab] = useState<"overview" | "merchants" | "audit" | "ledger">("overview");
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [merchants, setMerchants] = useState<MerchantItem[]>([]);
  const [merchantsTotal, setMerchantsTotal] = useState(0);
  const [merchantSearch, setMerchantSearch] = useState("");
  const [merchantStatusFilter, setMerchantStatusFilter] = useState<string>("");
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationReport | null>(null);

  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  // Modal state for merchant status update
  const [modalMerchant, setModalMerchant] = useState<MerchantItem | null>(null);
  const [modalNewStatus, setModalNewStatus] = useState<"ACTIVE" | "SUSPENDED">("SUSPENDED");
  const [modalReason, setModalReason] = useState("");
  const [submittingStatus, setSubmittingStatus] = useState(false);

  function loadOverview() {
    apiData<PlatformOverview>("/admin/overview")
      .then(setOverview)
      .catch((e) => setActionError(e.message));
  }

  function loadMerchants() {
    const params = new URLSearchParams();
    if (merchantSearch) params.set("search", merchantSearch);
    if (merchantStatusFilter) params.set("status", merchantStatusFilter);
    params.set("pageSize", "50");

    apiData<{ items: MerchantItem[]; pagination: { total: number } }>(`/admin/merchants?${params.toString()}`)
      .then((res) => {
        setMerchants(res.items);
        setMerchantsTotal(res.pagination.total);
      })
      .catch((e) => setActionError(e.message));
  }

  function loadAuditLogs() {
    apiData<{ items: AuditLogItem[] }>("/admin/audit-logs?pageSize=50")
      .then((res) => setAuditLogs(res.items))
      .catch((e) => setActionError(e.message));
  }

  function loadReconciliation() {
    apiData<ReconciliationReport>("/admin/ledger/reconciliation")
      .then(setReconciliation)
      .catch((e) => setActionError(e.message));
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([
      apiData<PlatformOverview>("/admin/overview").then(setOverview),
      apiData<{ items: MerchantItem[]; pagination: { total: number } }>("/admin/merchants?pageSize=50").then((res) => {
        setMerchants(res.items);
        setMerchantsTotal(res.pagination.total);
      }),
      apiData<{ items: AuditLogItem[] }>("/admin/audit-logs?pageSize=50").then((res) => setAuditLogs(res.items)),
      apiData<ReconciliationReport>("/admin/ledger/reconciliation").then(setReconciliation),
    ])
      .catch((e) => setActionError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleStatusSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!modalMerchant) return;
    if (modalReason.trim().length < 5) {
      setActionError("Please provide an audit reason of at least 5 characters.");
      return;
    }

    setSubmittingStatus(true);
    setActionError("");
    setActionSuccess("");

    try {
      const res = await apiFetch(`/admin/merchants/${modalMerchant.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: modalNewStatus, reason: modalReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to update merchant status");

      setActionSuccess(`Merchant ${modalMerchant.name} updated to ${modalNewStatus}`);
      setModalMerchant(null);
      setModalReason("");
      loadMerchants();
      loadOverview();
      loadAuditLogs();
    } catch (err: any) {
      setActionError(err.message || "Failed to update merchant status");
    } finally {
      setSubmittingStatus(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60, gap: 10 }}>
        <span className="spinner" />
        <span className="muted">Loading Platform Administration Console…</span>
      </div>
    );
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PLATFORM ADMINISTRATION</p>
          <h1>CryptoPOS Operations & Controls</h1>
          <p className="muted">
            Manage merchants, oversee network volume, inspect system audit logs, and monitor double-entry accounting reconciliation.
          </p>
        </div>
      </div>

      {actionSuccess && (
        <div className="panel" style={{ background: "#0c1f17", borderColor: "#1a4d3a", marginBottom: 20, color: "var(--green)" }}>
          ✓ {actionSuccess}
        </div>
      )}

      {actionError && (
        <div className="warning-callout" style={{ marginBottom: 20 }}>
          <strong>Admin Alert</strong>
          <span>{actionError}</span>
        </div>
      )}

      {/* Admin Tabs */}
      <div style={{ display: "flex", gap: 10, borderBottom: "1px solid var(--line)", paddingBottom: 12, marginBottom: 24 }}>
        <button
          className={tab === "overview" ? "button" : "secondary-button"}
          onClick={() => setTab("overview")}
          type="button"
          style={{ minHeight: 38 }}
        >
          Overview & Health
        </button>
        <button
          className={tab === "merchants" ? "button" : "secondary-button"}
          onClick={() => setTab("merchants")}
          type="button"
          style={{ minHeight: 38 }}
        >
          Merchants ({merchantsTotal})
        </button>
        <button
          className={tab === "audit" ? "button" : "secondary-button"}
          onClick={() => setTab("audit")}
          type="button"
          style={{ minHeight: 38 }}
        >
          Audit Logs
        </button>
        <button
          className={tab === "ledger" ? "button" : "secondary-button"}
          onClick={() => setTab("ledger")}
          type="button"
          style={{ minHeight: 38 }}
        >
          Ledger Reconciliation
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {tab === "overview" && overview && (
        <>
          <div className="metric-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 24 }}>
            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>ACTIVE MERCHANTS</span>
              <strong style={{ fontSize: 26 }}>{overview.merchants.active}</strong>
              <small className="muted" style={{ display: "block", marginTop: 4 }}>
                {overview.merchants.suspended} suspended ({overview.merchants.total} total)
              </small>
            </article>

            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>TOTAL VOLUME (NET)</span>
              <strong style={{ color: "var(--green)", fontSize: 26 }}>
                {overview.financialTotals.netVolumeFormatted} {overview.token.symbol}
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 4 }}>
                Gross: {overview.financialTotals.grossVolumeFormatted} USDC
              </small>
            </article>

            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>PLATFORM FEES COLLECTED</span>
              <strong style={{ fontSize: 26 }}>
                {overview.financialTotals.feeVolumeFormatted} {overview.token.symbol}
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 4 }}>
                Direct on-chain fee allocation
              </small>
            </article>

            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>REFUNDS PROCESSED</span>
              <strong style={{ color: "#ff8c8c", fontSize: 26 }}>
                -{overview.financialTotals.refundVolumeFormatted} {overview.token.symbol}
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 4 }}>
                {overview.financialTotals.confirmedRefundCount} verified refund{overview.financialTotals.confirmedRefundCount === 1 ? "" : "s"}
              </small>
            </article>

            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>BILLS GENERATED</span>
              <strong style={{ fontSize: 26 }}>{overview.bills.total}</strong>
              <small className="muted" style={{ display: "block", marginTop: 4 }}>
                {overview.financialTotals.confirmedTransactionCount} paid & confirmed
              </small>
            </article>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Solana Devnet & Indexer Health */}
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Solana Devnet Indexer Status</h2>
                  <p className="muted">Background worker monitoring on-chain payment settlements.</p>
                </div>
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Network:</span>
                  <strong>Solana Devnet</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">USDC Mint:</span>
                  <span style={{ fontFamily: "monospace", fontSize: 12 }}>{overview.token.mint}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Worker State:</span>
                  <span style={{ color: overview.indexer.status === "ACTIVE" ? "var(--green)" : "#ffb84d", fontWeight: 700 }}>
                    ● {overview.indexer.status}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Last Indexed Slot:</span>
                  <strong>{overview.indexer.lastSlot}</strong>
                </div>
                {overview.indexer.updatedAt && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span className="muted">Last Checkpoint:</span>
                    <span>{new Date(overview.indexer.updatedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </section>

            {/* Accounting System Health */}
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Double-Entry Ledger Health</h2>
                  <p className="muted">Cryptographically audited accounting records.</p>
                </div>
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Posted Journals:</span>
                  <strong>{overview.ledger.postedJournalsCount}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">System Balance Status:</span>
                  <span style={{ color: reconciliation?.isSystemBalanced ? "var(--green)" : "#ff8c8c", fontWeight: 700 }}>
                    {reconciliation?.isSystemBalanced ? "✓ BALANCED (Debits = Credits)" : "⚠ REVIEW REQUIRED"}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Total Debits:</span>
                  <strong>{reconciliation?.systemTotalDebitFormatted} USDC</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span className="muted">Total Credits:</span>
                  <strong>{reconciliation?.systemTotalCreditFormatted} USDC</strong>
                </div>
              </div>
            </section>
          </div>
        </>
      )}

      {/* TAB 2: MERCHANTS DIRECTORY */}
      {tab === "merchants" && (
        <section className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 260 }}>
              <input
                type="text"
                placeholder="Search merchant by name or settlement address…"
                value={merchantSearch}
                onChange={(e) => setMerchantSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadMerchants()}
                style={{
                  flex: 1,
                  background: "#0e1520",
                  border: "1px solid #35445b",
                  borderRadius: 6,
                  color: "var(--text)",
                  padding: "8px 12px",
                  fontSize: 13,
                }}
              />
              <select
                value={merchantStatusFilter}
                onChange={(e) => {
                  setMerchantStatusFilter(e.target.value);
                }}
                style={{
                  background: "#0e1520",
                  border: "1px solid #35445b",
                  borderRadius: 6,
                  color: "var(--text)",
                  padding: "8px 12px",
                  fontSize: 13,
                }}
              >
                <option value="">All Statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
              <button className="button" onClick={loadMerchants} type="button" style={{ minHeight: 38, padding: "8px 16px" }}>
                Filter
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Settlement Address</th>
                  <th className="align-right">Paid Bills</th>
                  <th className="align-right">Volume (USDC)</th>
                  <th className="align-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {merchants.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/admin/merchants/${m.id}`} style={{ fontWeight: 700, color: "var(--green)", textDecoration: "none" }}>
                        {m.name}
                      </Link>
                      {m.businessType && <div className="muted" style={{ fontSize: 12 }}>{m.businessType}</div>}
                    </td>
                    <td>
                      <span
                        style={{
                          padding: "3px 8px",
                          borderRadius: 99,
                          fontSize: 11,
                          fontWeight: 700,
                          background: m.status === "ACTIVE" ? "#132a24" : "#281010",
                          color: m.status === "ACTIVE" ? "var(--green)" : "#ff8c8c",
                          border: m.status === "ACTIVE" ? "1px solid #2c6f5d" : "1px solid #7a1a1a",
                        }}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td>
                      {m.owner ? (
                        <div>
                          <div>{m.owner.name}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{m.owner.email}</div>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {m.settlementAddress ? (
                        <span style={{ fontFamily: "monospace", fontSize: 12 }}>
                          {m.settlementAddress.slice(0, 4)}…{m.settlementAddress.slice(-4)}
                        </span>
                      ) : (
                        <span className="muted">Not configured</span>
                      )}
                    </td>
                    <td className="align-right">{m.paidBillsCount}</td>
                    <td className="align-right"><strong>{m.confirmedVolumeFormatted}</strong></td>
                    <td className="align-right">
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <Link
                          href={`/admin/merchants/${m.id}`}
                          className="secondary-button"
                          style={{ padding: "4px 8px", fontSize: 11 }}
                        >
                          Details
                        </Link>
                        {m.status === "ACTIVE" ? (
                          <button
                            className="secondary-button"
                            style={{ padding: "4px 8px", fontSize: 11, borderColor: "#7a1a1a", color: "#ff8c8c" }}
                            onClick={() => {
                              setModalMerchant(m);
                              setModalNewStatus("SUSPENDED");
                              setModalReason("");
                            }}
                            type="button"
                          >
                            Suspend
                          </button>
                        ) : (
                          <button
                            className="secondary-button"
                            style={{ padding: "4px 8px", fontSize: 11, borderColor: "#2c6f5d", color: "var(--green)" }}
                            onClick={() => {
                              setModalMerchant(m);
                              setModalNewStatus("ACTIVE");
                              setModalReason("");
                            }}
                            type="button"
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 3: AUDIT LOGS */}
      {tab === "audit" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Platform Audit Trail</h2>
              <p className="muted">Immutable log of administrative operations, policy changes, and merchant status updates.</p>
            </div>
            <button className="secondary-button" onClick={loadAuditLogs} type="button" style={{ fontSize: 12 }}>
              Refresh
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Admin Actor</th>
                  <th>Action</th>
                  <th>Target Type</th>
                  <th>Details & Reason</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{new Date(log.createdAt).toLocaleString()}</td>
                    <td><strong>{log.actorEmail}</strong></td>
                    <td>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--green)" }}>{log.action}</span>
                    </td>
                    <td>{log.targetType}</td>
                    <td style={{ fontSize: 12 }}>
                      {log.details ? (
                        <div>
                          {log.details.reason && <div><strong>Reason:</strong> {log.details.reason}</div>}
                          {log.details.previousStatus && (
                            <div className="muted">
                              Status change: {log.details.previousStatus} → {log.details.newStatus}
                            </div>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 4: RECONCILIATION */}
      {tab === "ledger" && reconciliation && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Double-Entry Ledger Reconciliation Report</h2>
              <p className="muted">
                System-wide audit verifying debit-credit equilibrium across all posted transactions and refund adjustments.
              </p>
            </div>
            <button className="secondary-button" onClick={loadReconciliation} type="button" style={{ fontSize: 12 }}>
              Re-run Audit
            </button>
          </div>

          <div className="metric-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginBottom: 20 }}>
            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>AUDITED JOURNALS</span>
              <strong style={{ fontSize: 24 }}>{reconciliation.totalJournalsAudited}</strong>
            </article>
            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>TOTAL DEBITS</span>
              <strong style={{ fontSize: 24 }}>{reconciliation.systemTotalDebitFormatted} USDC</strong>
            </article>
            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>TOTAL CREDITS</span>
              <strong style={{ fontSize: 24 }}>{reconciliation.systemTotalCreditFormatted} USDC</strong>
            </article>
            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>STATUS</span>
              <strong style={{ color: reconciliation.isSystemBalanced ? "var(--green)" : "#ff8c8c", fontSize: 24 }}>
                {reconciliation.isSystemBalanced ? "BALANCED" : "DISCREPANCY"}
              </strong>
            </article>
          </div>

          {reconciliation.imbalancedCount === 0 ? (
            <div style={{ padding: 24, textAlign: "center", background: "#0c1f17", border: "1px solid #1a4d3a", borderRadius: 8 }}>
              <h3 style={{ color: "var(--green)", margin: "0 0 6px 0" }}>✓ All Double-Entry Ledger Accounts Perfectly Balanced</h3>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Every posted transaction and refund adjustment in the system maintains exact integer debit-credit balance.
              </p>
            </div>
          ) : (
            <div className="warning-callout">
              <strong>Imbalanced Journals Detected ({reconciliation.imbalancedCount}):</strong>
              <ul>
                {reconciliation.imbalancedJournals.map((j) => (
                  <li key={j.journalId}>
                    Journal ID: {j.journalId} | Difference: {j.difference} units | Merchant: {j.merchantName}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Status Update Confirmation Modal */}
      {modalMerchant && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#000a",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 1000,
          }}
        >
          <div className="panel" style={{ width: "100%", maxWidth: 500, background: "var(--panel)" }}>
            <h2>Confirm Merchant Status Change</h2>
            <p className="muted">
              You are about to change the status of <strong>{modalMerchant.name}</strong> from{" "}
              <span style={{ color: modalMerchant.status === "ACTIVE" ? "var(--green)" : "#ff8c8c" }}>
                {modalMerchant.status}
              </span>{" "}
              to{" "}
              <span style={{ color: modalNewStatus === "ACTIVE" ? "var(--green)" : "#ff8c8c" }}>
                {modalNewStatus}
              </span>
              .
            </p>

            {modalNewStatus === "SUSPENDED" && (
              <p style={{ color: "#ff8c8c", fontSize: 13 }}>
                Warning: Suspending a merchant will immediately block all cashier and owner API actions for this merchant.
              </p>
            )}

            <form onSubmit={handleStatusSubmit} style={{ display: "grid", gap: 14, marginTop: 16 }}>
              <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 600 }}>
                Audit Reason (required):
                <textarea
                  required
                  rows={3}
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  placeholder="Specify the reason for this administrative status mutation…"
                  style={{
                    background: "#0e1520",
                    border: "1px solid #35445b",
                    borderRadius: 6,
                    color: "var(--text)",
                    padding: "8px 12px",
                    fontFamily: "inherit",
                    fontSize: 13,
                  }}
                />
              </label>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setModalMerchant(null)}
                  disabled={submittingStatus}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button"
                  disabled={submittingStatus}
                  style={{
                    background: modalNewStatus === "SUSPENDED" ? "#ff8c8c" : "var(--green)",
                    color: "#0c111b",
                  }}
                >
                  {submittingStatus ? "Updating…" : `Confirm ${modalNewStatus}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
