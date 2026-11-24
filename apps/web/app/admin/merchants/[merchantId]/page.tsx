"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { apiData, apiFetch } from "../../../../lib/api";

interface MerchantDetailData {
  merchant: {
    id: string;
    name: string;
    businessType: string | null;
    status: "ACTIVE" | "SUSPENDED";
    settlementAddress: string | null;
    createdAt: string;
  };
  members: Array<{
    id: string;
    name: string;
    email: string;
    merchantRole: string;
  }>;
  wallets: Array<{
    address: string;
    network: string;
    purpose: string;
    createdAt: string;
  }>;
  volume: {
    grossUnits: string;
    grossFormatted: string;
    refundUnits: string;
    refundFormatted: string;
    netUnits: string;
    netFormatted: string;
    feeUnits: string;
    feeFormatted: string;
    transactionCount: number;
    refundCount: number;
  };
  billsByStatus: Record<string, number>;
  auditLogs: Array<{
    id: string;
    actorEmail: string;
    action: string;
    details: any;
    createdAt: string;
  }>;
}

export default function AdminMerchantDetailPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const resolvedParams = use(params);
  const merchantId = resolvedParams.merchantId;

  const [data, setData] = useState<MerchantDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [updating, setUpdating] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  function loadDetails() {
    setLoading(true);
    apiData<MerchantDetailData>(`/admin/merchants/${merchantId}`)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }

  useEffect(() => {
    loadDetails();
  }, [merchantId]);

  async function toggleStatus(newStatus: "ACTIVE" | "SUSPENDED") {
    if (!statusReason.trim() || statusReason.trim().length < 5) {
      setError("Please specify an audit reason of at least 5 characters.");
      return;
    }
    setUpdating(true);
    setError("");
    setSuccessMsg("");

    try {
      const res = await apiFetch(`/admin/merchants/${merchantId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus, reason: statusReason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to update status");

      setSuccessMsg(`Merchant status updated to ${newStatus}`);
      setStatusReason("");
      loadDetails();
    } catch (e: any) {
      setError(e.message || "Failed to update status");
    } finally {
      setUpdating(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60, gap: 10 }}>
        <span className="spinner" />
        <span className="muted">Loading merchant details…</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="warning-callout">
        <strong>Error:</strong>
        <span>{error}</span>
        <div style={{ marginTop: 12 }}>
          <Link href="/admin" className="button">
            Back to Admin
          </Link>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const m = data.merchant;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Link href="/admin" className="text-link" style={{ fontSize: 13 }}>
          ← Back to Platform Admin
        </Link>
      </div>

      <div className="page-heading">
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ margin: 0 }}>{m.name}</h1>
            <span
              style={{
                padding: "3px 10px",
                borderRadius: 99,
                fontSize: 12,
                fontWeight: 700,
                background: m.status === "ACTIVE" ? "#132a24" : "#281010",
                color: m.status === "ACTIVE" ? "var(--green)" : "#ff8c8c",
                border: m.status === "ACTIVE" ? "1px solid #2c6f5d" : "1px solid #7a1a1a",
              }}
            >
              {m.status}
            </span>
          </div>
          <p className="muted" style={{ marginTop: 6 }}>
            Merchant ID: <code style={{ fontSize: 12 }}>{m.id}</code> | Created {new Date(m.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {successMsg && (
        <div className="panel" style={{ background: "#0c1f17", borderColor: "#1a4d3a", marginBottom: 20, color: "var(--green)" }}>
          ✓ {successMsg}
        </div>
      )}

      {error && (
        <div className="warning-callout" style={{ marginBottom: 20 }}>
          <strong>Action Alert:</strong>
          <span>{error}</span>
        </div>
      )}

      {/* Metrics Overview */}
      <div className="metric-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", marginBottom: 20 }}>
        <article className="metric-card">
          <span className="eyebrow" style={{ fontSize: 11 }}>NET SALES</span>
          <strong style={{ color: "var(--green)", fontSize: 24 }}>{data.volume.netFormatted} USDC</strong>
          <small className="muted" style={{ display: "block", marginTop: 4 }}>
            Gross: {data.volume.grossFormatted} USDC
          </small>
        </article>
        <article className="metric-card">
          <span className="eyebrow" style={{ fontSize: 11 }}>TOTAL REFUNDS</span>
          <strong style={{ color: "#ff8c8c", fontSize: 24 }}>-{data.volume.refundFormatted} USDC</strong>
          <small className="muted" style={{ display: "block", marginTop: 4 }}>
            {data.volume.refundCount} refunds
          </small>
        </article>
        <article className="metric-card">
          <span className="eyebrow" style={{ fontSize: 11 }}>VERIFIED TRANSACTIONS</span>
          <strong style={{ fontSize: 24 }}>{data.volume.transactionCount}</strong>
        </article>
        <article className="metric-card">
          <span className="eyebrow" style={{ fontSize: 11 }}>FEES ALLOCATED</span>
          <strong style={{ fontSize: 24 }}>{data.volume.feeFormatted} USDC</strong>
        </article>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
        {/* Settlement & Wallet Info */}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Settlement Configuration</h2>
              <p className="muted">Devnet address for customer direct settlement.</p>
            </div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>Configured Settlement Address:</span>
              <div style={{ fontFamily: "monospace", fontSize: 13, wordBreak: "break-all", marginTop: 4 }}>
                {m.settlementAddress || "None configured"}
              </div>
            </div>
            <div>
              <span className="muted" style={{ fontSize: 12 }}>Network:</span>
              <div style={{ fontWeight: 600 }}>Solana Devnet</div>
            </div>
          </div>
        </section>

        {/* Status Mutation Controls */}
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Account Status Administration</h2>
              <p className="muted">Suspend or restore merchant POS and settlement access.</p>
            </div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 600 }}>
              Audit Reason:
              <input
                type="text"
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                placeholder="Enter mandatory reason for status mutation…"
                style={{
                  background: "#0e1520",
                  border: "1px solid #35445b",
                  borderRadius: 6,
                  color: "var(--text)",
                  padding: "8px 12px",
                  fontSize: 13,
                }}
              />
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              {m.status === "ACTIVE" ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => toggleStatus("SUSPENDED")}
                  disabled={updating}
                  style={{ borderColor: "#7a1a1a", color: "#ff8c8c" }}
                >
                  {updating ? "Updating…" : "Suspend Merchant"}
                </button>
              ) : (
                <button
                  type="button"
                  className="button"
                  onClick={() => toggleStatus("ACTIVE")}
                  disabled={updating}
                >
                  {updating ? "Updating…" : "Re-activate Merchant"}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Team Members */}
      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-heading">
          <div>
            <h2>Authorized Team Members</h2>
            <p className="muted">Users with access to this merchant workspace.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <tr key={member.id}>
                  <td><strong>{member.name}</strong></td>
                  <td>{member.email}</td>
                  <td>
                    <span className="role-pill" style={{ fontSize: 11, padding: "2px 8px" }}>
                      {member.merchantRole}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Merchant Audit History */}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Admin Audit History for this Merchant</h2>
            <p className="muted">Logged operations executed on this merchant record.</p>
          </div>
        </div>
        {data.auditLogs.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Admin Actor</th>
                  <th>Action</th>
                  <th>Details & Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ fontSize: 12 }}>{new Date(log.createdAt).toLocaleString()}</td>
                    <td>{log.actorEmail}</td>
                    <td>
                      <span style={{ fontWeight: 700, color: "var(--green)", fontSize: 12 }}>{log.action}</span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {log.details?.reason ? `Reason: ${log.details.reason}` : JSON.stringify(log.details)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No admin actions logged for this merchant yet.</p>
        )}
      </section>
    </>
  );
}
