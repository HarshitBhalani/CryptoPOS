"use client";

import { useEffect, useState } from "react";
import { apiData } from "../../../lib/api";
import { useDashboard } from "../dashboard-context";

interface AnalyticsOverview {
  period: { startDate: string; endDate: string };
  asset: { tokenSymbol: string; network: string; decimals: number };
  cryptoMetrics: {
    grossSalesUnits: string;
    grossSalesFormatted: string;
    refundUnits: string;
    refundFormatted: string;
    netSalesUnits: string;
    netSalesFormatted: string;
    platformFeeUnits: string;
    platformFeeFormatted: string;
    averagePaymentUnits: string;
    averagePaymentFormatted: string;
    transactionCount: number;
    refundCount: number;
  };
  fiatMetrics: {
    currency: string;
    grossSales: string;
    refunds: string;
    netSales: string;
  };
  billStatusDistribution: Record<string, number>;
  ledgerIntegrity: {
    postedJournalsCount: number;
    totalDebitUnits: string;
    totalCreditUnits: string;
    isBalanced: boolean;
  };
}

interface TimeSeriesItem {
  date: string;
  grossSalesFormatted: string;
  refundFormatted: string;
  netSalesFormatted: string;
  feeFormatted: string;
  transactionCount: number;
  refundCount: number;
  fiatGrossSales: string;
  fiatNetSales: string;
}

export default function AnalyticsPage() {
  const { merchant } = useDashboard();
  const [rangePreset, setRangePreset] = useState<"7d" | "30d" | "90d" | "custom">("30d");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesItem[]>([]);

  function applyPreset(preset: "7d" | "30d" | "90d") {
    setRangePreset(preset);
    const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    setStartDate(start.toISOString().slice(0, 10));
    setEndDate(new Date().toISOString().slice(0, 10));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    const startIso = new Date(`${startDate}T00:00:00.000Z`).toISOString();
    const endIso = new Date(`${endDate}T23:59:59.999Z`).toISOString();

    const query = `?startDate=${encodeURIComponent(startIso)}&endDate=${encodeURIComponent(endIso)}`;

    Promise.all([
      apiData<AnalyticsOverview>(`/merchants/${merchant.id}/analytics/overview${query}`),
      apiData<{ series: TimeSeriesItem[] }>(`/merchants/${merchant.id}/analytics/series${query}`),
    ])
      .then(([ov, ts]) => {
        if (!cancelled) {
          setOverview(ov);
          setTimeSeries(ts.series);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || "Failed to load merchant analytics");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [merchant.id, startDate, endDate]);

  return (
    <>
      <div className="page-heading">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <p className="eyebrow">FINANCIAL PERFORMANCE</p>
            <span
              style={{
                background: "#281d09",
                border: "1px solid #7a5416",
                color: "#ffb84d",
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 4,
                fontWeight: 700,
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              Solana Devnet Testnet
            </span>
          </div>
          <h1>Sales & Payments Analytics</h1>
          <p className="muted">
            Audited financial source of truth derived strictly from finalized, independently verified transactions
            and posted double-entry ledger entries for {merchant.name}.
          </p>
        </div>
      </div>

      {/* Date Range Selector Bar */}
      <section className="panel" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={rangePreset === "7d" ? "button" : "secondary-button"}
              onClick={() => applyPreset("7d")}
              type="button"
            >
              Last 7 Days
            </button>
            <button
              className={rangePreset === "30d" ? "button" : "secondary-button"}
              onClick={() => applyPreset("30d")}
              type="button"
            >
              Last 30 Days
            </button>
            <button
              className={rangePreset === "90d" ? "button" : "secondary-button"}
              onClick={() => applyPreset("90d")}
              type="button"
            >
              Last 90 Days
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              From:
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setRangePreset("custom");
                  setStartDate(e.target.value);
                }}
                style={{
                  background: "#0e1520",
                  border: "1px solid #35445b",
                  borderRadius: 6,
                  color: "var(--text)",
                  padding: "6px 10px",
                  fontSize: 13,
                }}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
              To:
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setRangePreset("custom");
                  setEndDate(e.target.value);
                }}
                style={{
                  background: "#0e1520",
                  border: "1px solid #35445b",
                  borderRadius: 6,
                  color: "var(--text)",
                  padding: "6px 10px",
                  fontSize: 13,
                }}
              />
            </label>
          </div>
        </div>
      </section>

      {error && (
        <div className="warning-callout" style={{ marginBottom: 20 }}>
          <strong>Error loading analytics</strong>
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 40, gap: 10 }}>
          <span className="spinner" />
          <span className="muted">Calculating verified financial analytics…</span>
        </div>
      )}

      {!loading && overview && (
        <>
          {/* Top KPI Metric Cards */}
          <div className="metric-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 20 }}>
            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>NET SALES</span>
              <strong style={{ color: "var(--green)", fontSize: 24 }}>
                {overview.cryptoMetrics.netSalesFormatted} {overview.asset.tokenSymbol}
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 4 }}>
                Equivalent: {overview.fiatMetrics.currency} ${overview.fiatMetrics.netSales}
              </small>
            </article>

            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>GROSS SALES</span>
              <strong style={{ fontSize: 24 }}>
                {overview.cryptoMetrics.grossSalesFormatted} {overview.asset.tokenSymbol}
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 4 }}>
                {overview.cryptoMetrics.transactionCount} verified transaction{overview.cryptoMetrics.transactionCount === 1 ? "" : "s"}
              </small>
            </article>

            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>REFUNDS</span>
              <strong style={{ color: "#ff8c8c", fontSize: 24 }}>
                -{overview.cryptoMetrics.refundFormatted} {overview.asset.tokenSymbol}
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 4 }}>
                {overview.cryptoMetrics.refundCount} confirmed refund{overview.cryptoMetrics.refundCount === 1 ? "" : "s"}
              </small>
            </article>

            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>PLATFORM FEES PAID</span>
              <strong style={{ fontSize: 24 }}>
                {overview.cryptoMetrics.platformFeeFormatted} {overview.asset.tokenSymbol}
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 4 }}>
                Direct on-chain fee allocation
              </small>
            </article>

            <article className="metric-card">
              <span className="eyebrow" style={{ fontSize: 11 }}>AVERAGE PAYMENT</span>
              <strong style={{ fontSize: 24 }}>
                {overview.cryptoMetrics.averagePaymentFormatted} {overview.asset.tokenSymbol}
              </strong>
              <small className="muted" style={{ display: "block", marginTop: 4 }}>
                Per verified bill settlement
              </small>
            </article>
          </div>

          {/* Double-Entry Ledger Integrity Card */}
          <section
            className="panel"
            style={{
              marginBottom: 20,
              border: overview.ledgerIntegrity.isBalanced ? "1px solid #1a4d3a" : "1px solid #7a1a1a",
              background: overview.ledgerIntegrity.isBalanced ? "#0c1f17" : "#1f0c0c",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h3 style={{ margin: "0 0 4px 0", color: overview.ledgerIntegrity.isBalanced ? "var(--green)" : "#ff8c8c" }}>
                  {overview.ledgerIntegrity.isBalanced ? "✓ Double-Entry Ledger Audited & Balanced" : "⚠ Ledger Discrepancy Detected"}
                </h3>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  All sales figures are backed by immutable double-entry journal entries posted upon on-chain finalization.
                </p>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 13 }}>
                <div>
                  <span className="muted">Posted Journals: </span>
                  <strong>{overview.ledgerIntegrity.postedJournalsCount}</strong>
                </div>
                <div>
                  <span className="muted">Debits = Credits: </span>
                  <strong style={{ color: overview.ledgerIntegrity.isBalanced ? "var(--green)" : "#ff8c8c" }}>
                    {overview.ledgerIntegrity.isBalanced ? "MATCHED" : "IMBALANCED"}
                  </strong>
                </div>
              </div>
            </div>
          </section>

          {/* Time Series Breakdown Panel */}
          <section className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-heading">
              <div>
                <h2>Daily Financial Breakdown</h2>
                <p className="muted">Daily verified settlements, refunds, and net volume in chronological order.</p>
              </div>
            </div>

            {timeSeries.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date (UTC)</th>
                      <th>Transactions</th>
                      <th className="align-right">Gross (USDC)</th>
                      <th className="align-right">Refunds (USDC)</th>
                      <th className="align-right">Net Sales (USDC)</th>
                      <th className="align-right">Fees (USDC)</th>
                      <th className="align-right">Fiat Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeSeries.map((row) => (
                      <tr key={row.date}>
                        <td><strong>{row.date}</strong></td>
                        <td>
                          {row.transactionCount} {row.refundCount > 0 && <span style={{ color: "#ff8c8c" }}>({row.refundCount} ref)</span>}
                        </td>
                        <td className="align-right">{row.grossSalesFormatted}</td>
                        <td className="align-right" style={{ color: row.refundFormatted !== "0.000000" ? "#ff8c8c" : "inherit" }}>
                          {row.refundFormatted !== "0.000000" ? `-${row.refundFormatted}` : "0.000000"}
                        </td>
                        <td className="align-right" style={{ color: "var(--green)", fontWeight: 700 }}>
                          {row.netSalesFormatted}
                        </td>
                        <td className="align-right">{row.feeFormatted}</td>
                        <td className="align-right">{overview.fiatMetrics.currency} ${row.fiatNetSales}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No activity recorded for this period.</p>
            )}
          </section>

          {/* Bill Status Breakdown */}
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Bill Status Distribution</h2>
                <p className="muted">Status counts for bills created during this period.</p>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
              {Object.entries(overview.billStatusDistribution).map(([status, count]) => (
                <div
                  key={status}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 8,
                    background: "#0e1520",
                    border: "1px solid var(--line)",
                  }}
                >
                  <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>
                    {status.replaceAll("_", " ")}
                  </span>
                  <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{count}</div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}
