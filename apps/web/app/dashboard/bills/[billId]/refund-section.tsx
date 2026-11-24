"use client";

import { useEffect, useState, useCallback } from "react";
import { apiData } from "../../../../lib/api";
import { buildUsdcRefundTransaction } from "../../../../lib/payment";

type VerifiedTx = {
  id: string;
  signature: string;
  amountUnits: string;
  formattedAmount: string;
  sourceOwner: string;
  destinationOwner: string;
  blockTime?: string | null;
};

type RefundAuditLog = {
  id: string;
  actorId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  notes: string | null;
  createdAt: string;
};

type RefundItem = {
  id: string;
  billId: string;
  verifiedTxId: string;
  amountUnits: string;
  formattedAmount: string;
  currency: string;
  fiatAmount: string | null;
  destinationWallet: string;
  isDestinationOverridden: boolean;
  sourceWallet: string;
  reason: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "PENDING" | "CONFIRMED" | "FAILED";
  signature?: string | null;
  reference?: string | null;
  failureReason?: string | null;
  createdAt: string;
  approvedAt?: string | null;
  confirmedAt?: string | null;
  auditLogs?: RefundAuditLog[];
};

type RefundSummary = {
  billId: string;
  billNumber: string;
  totalPaidUnits: string;
  formattedTotalPaid: string;
  totalFeeUnits: string;
  formattedTotalFee: string;
  totalConfirmedRefundUnits: string;
  formattedTotalConfirmedRefund: string;
  totalReservedRefundUnits: string;
  remainingRefundableUnits: string;
  formattedRemainingRefundable: string;
  isRefundable: boolean;
  feePolicyNote: string;
  verifiedTransactions: VerifiedTx[];
  activeRefunds: { id: string; status: string; formattedAmount: string }[];
};

interface RefundSectionProps {
  billId: string;
  merchantId: string;
  isOwner: boolean;
}

export function RefundSection({ billId, merchantId, isOwner }: RefundSectionProps) {
  const [summary, setSummary] = useState<RefundSummary | null>(null);
  const [refunds, setRefunds] = useState<RefundItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  // Request form state
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [selectedTxId, setSelectedTxId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [destinationInput, setDestinationInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);

  // Signing state
  const [activeSigningRefundId, setActiveSigningRefundId] = useState<string | null>(null);
  const [signingStatus, setSigningStatus] = useState<string>("");

  const loadData = useCallback(async () => {
    try {
      const [sumRes, refRes] = await Promise.all([
        apiData<RefundSummary>(`/merchants/${merchantId}/refunds/summary/${billId}`),
        apiData<{ refunds: RefundItem[] }>(`/merchants/${merchantId}/refunds?billId=${billId}`),
      ]);
      setSummary(sumRes);
      setRefunds(refRes.refunds);
      if (sumRes.verifiedTransactions.length > 0 && !selectedTxId) {
        setSelectedTxId(sumRes.verifiedTransactions[0].id);
        setDestinationInput(sumRes.verifiedTransactions[0].sourceOwner);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load refund data");
    } finally {
      setLoading(false);
    }
  }, [merchantId, billId, selectedTxId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle selected tx change
  function handleTxSelect(txId: string) {
    setSelectedTxId(txId);
    const tx = summary?.verifiedTransactions.find((t) => t.id === txId);
    if (tx) {
      setDestinationInput(tx.sourceOwner);
    }
  }

  // Quick Max button
  function handleFillMax() {
    if (!summary) return;
    setAmountInput(summary.formattedRemainingRefundable);
  }

  // Submit refund request
  async function handleCreateRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!amountInput || parseFloat(amountInput) <= 0) {
      setError("Please enter a valid refund amount.");
      return;
    }
    if (!reasonInput.trim()) {
      setError("Refund reason is mandatory.");
      return;
    }

    setSubmittingRequest(true);
    setError("");
    setActionMsg("");

    try {
      // Convert formatted USDC to integer smallest units (6 decimals)
      const cleanAmount = parseFloat(amountInput).toFixed(6);
      const units = BigInt(Math.round(parseFloat(cleanAmount) * 1_000_000)).toString();

      const idempotencyKey = `ref_req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      await apiData(`/merchants/${merchantId}/refunds`, {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify({
          verifiedTxId: selectedTxId,
          amountUnits: units,
          reason: reasonInput.trim(),
          destinationWallet: destinationInput.trim() || undefined,
        }),
      });

      setActionMsg("Refund requested successfully. Awaiting merchant owner approval.");
      setShowRequestForm(false);
      setAmountInput("");
      setReasonInput("");
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to submit refund request.");
    } finally {
      setSubmittingRequest(false);
    }
  }

  // Owner Approve
  async function handleApprove(refundId: string) {
    setError("");
    setActionMsg("");
    try {
      await apiData(`/merchants/${merchantId}/refunds/${refundId}/approve`, {
        method: "POST",
      });
      setActionMsg("Refund approved. Ready for wallet signing.");
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to approve refund.");
    }
  }

  // Owner Reject
  async function handleReject(refundId: string) {
    const reason = window.prompt("Reason for rejecting this refund:");
    if (!reason) return;

    setError("");
    setActionMsg("");
    try {
      await apiData(`/merchants/${merchantId}/refunds/${refundId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setActionMsg("Refund rejected.");
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to reject refund.");
    }
  }

  // Owner Sign & Submit via Phantom
  async function handleSignAndSubmit(refund: RefundItem) {
    setActiveSigningRefundId(refund.id);
    setError("");
    setActionMsg("");
    setSigningStatus("Connecting to Phantom wallet...");

    try {
      const provider = (window as any).solana;
      if (!provider?.isPhantom) {
        throw new Error("Phantom wallet extension is required to sign this refund.");
      }

      const connectResp = await provider.connect();
      const connectedPubkey = connectResp.publicKey.toBase58();

      if (connectedPubkey !== refund.sourceWallet) {
        throw new Error(
          `Connected wallet (${connectedPubkey.slice(0, 6)}...) does not match merchant settlement wallet (${refund.sourceWallet.slice(0, 6)}...). Please switch to the settlement wallet in Phantom.`
        );
      }

      setSigningStatus("Building Solana Devnet USDC refund transaction...");
      if (!refund.reference) {
        throw new Error("Refund reference is missing. Re-approve the refund.");
      }

      const { transaction } = await buildUsdcRefundTransaction({
        merchantWallet: refund.sourceWallet,
        destinationWallet: refund.destinationWallet,
        amountUnits: BigInt(refund.amountUnits),
        reference: refund.reference,
      });

      setSigningStatus("Requesting wallet signature in Phantom...");
      const { signature } = await provider.signAndSendTransaction(transaction);

      setSigningStatus(`Broadcast signature ${signature.slice(0, 8)}... Submitting to backend...`);
      await apiData(`/merchants/${merchantId}/refunds/${refund.id}/submit`, {
        method: "POST",
        body: JSON.stringify({ signature }),
      });

      setSigningStatus("Verifying on-chain finalization...");
      // Trigger verify check
      try {
        await apiData(`/merchants/${merchantId}/refunds/${refund.id}/verify`, { method: "POST" });
      } catch {
        // Background indexer will pick it up
      }

      setActionMsg(`Refund transaction submitted (${signature.slice(0, 8)}...). Verification in progress.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || "Failed to sign or broadcast refund transaction.");
    } finally {
      setActiveSigningRefundId(null);
      setSigningStatus("");
    }
  }

  if (loading) {
    return <div className="panel"><p className="muted">Loading refund history…</p></div>;
  }

  if (!summary || summary.verifiedTransactions.length === 0) {
    return null; // No verified on-chain payments to refund
  }

  return (
    <section className="panel" style={{ marginTop: "24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <h2>Refunds & Adjustments</h2>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Non-custodial merchant refunds on Solana Devnet.
          </p>
        </div>
        {summary.isRefundable && !showRequestForm && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setShowRequestForm(true)}
          >
            + Request Refund
          </button>
        )}
      </div>

      {error && <p className="form-error" style={{ marginBottom: "12px" }}>{error}</p>}
      {actionMsg && <p style={{ color: "#48bb78", fontSize: "14px", marginBottom: "12px" }}>{actionMsg}</p>}

      {/* Refundable Balance Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", background: "#0a0f17", padding: "14px", borderRadius: "8px", border: "1px solid #1a2536", marginBottom: "16px" }}>
        <div>
          <span style={{ fontSize: "12px", color: "#88a7c9" }}>Total Verified Paid</span>
          <div style={{ fontSize: "18px", fontWeight: "700", color: "#ffffff" }}>{summary.formattedTotalPaid} USDC</div>
        </div>
        <div>
          <span style={{ fontSize: "12px", color: "#88a7c9" }}>Confirmed Refunded</span>
          <div style={{ fontSize: "18px", fontWeight: "700", color: "#e2e8f0" }}>{summary.formattedTotalConfirmedRefund} USDC</div>
        </div>
        <div>
          <span style={{ fontSize: "12px", color: "#88a7c9" }}>Remaining Refundable</span>
          <div style={{ fontSize: "18px", fontWeight: "700", color: "#48bb78" }}>{summary.formattedRemainingRefundable} USDC</div>
        </div>
      </div>

      <p style={{ fontSize: "12px", color: "#718096", margin: "0 0 16px" }}>
        ℹ️ {summary.feePolicyNote}
      </p>

      {/* Request Refund Form */}
      {showRequestForm && (
        <form onSubmit={handleCreateRefund} style={{ background: "#0e1520", padding: "16px", borderRadius: "8px", border: "1px solid #23344a", marginBottom: "20px" }}>
          <h3 style={{ margin: "0 0 12px", fontSize: "16px" }}>Request Refund</h3>

          {summary.verifiedTransactions.length > 1 && (
            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", fontSize: "12px", marginBottom: "4px" }}>Source Payment:</label>
              <select
                value={selectedTxId}
                onChange={(e) => handleTxSelect(e.target.value)}
                style={{ width: "100%", padding: "8px", background: "#06090e", border: "1px solid #23344a", color: "#fff", borderRadius: "4px" }}
              >
                {summary.verifiedTransactions.map((tx) => (
                  <option key={tx.id} value={tx.id}>
                    {tx.signature.slice(0, 12)}... ({tx.formattedAmount} USDC)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <label style={{ fontSize: "12px" }}>Refund Amount (USDC):</label>
              <button
                type="button"
                onClick={handleFillMax}
                style={{ background: "none", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: "12px", padding: 0 }}
              >
                Use Remaining Max ({summary.formattedRemainingRefundable} USDC)
              </button>
            </div>
            <input
              type="number"
              step="0.000001"
              min="0.000001"
              max={summary.formattedRemainingRefundable}
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0.000000"
              style={{ width: "100%", padding: "8px", background: "#06090e", border: "1px solid #23344a", color: "#fff", borderRadius: "4px" }}
              required
            />
          </div>

          <div style={{ marginBottom: "12px" }}>
            <label style={{ display: "block", fontSize: "12px", marginBottom: "4px" }}>
              Destination Wallet (Default: Original Payer):
            </label>
            <input
              type="text"
              value={destinationInput}
              onChange={(e) => setDestinationInput(e.target.value)}
              placeholder="Solana Base58 Public Key"
              style={{ width: "100%", padding: "8px", background: "#06090e", border: "1px solid #23344a", color: "#fff", borderRadius: "4px", fontSize: "12px" }}
              required
            />
            {summary.verifiedTransactions.find((t) => t.id === selectedTxId)?.sourceOwner !== destinationInput && (
              <p style={{ color: "#f6ad55", fontSize: "11px", margin: "4px 0 0" }}>
                ⚠️ Destination differs from original payer. Owner must explicitly approve before signing.
              </p>
            )}
          </div>

          <div style={{ marginBottom: "14px" }}>
            <label style={{ display: "block", fontSize: "12px", marginBottom: "4px" }}>Reason for Refund:</label>
            <textarea
              rows={2}
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              placeholder="e.g., Customer return, overpayment adjustment, billing error..."
              style={{ width: "100%", padding: "8px", background: "#06090e", border: "1px solid #23344a", color: "#fff", borderRadius: "4px" }}
              required
            />
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="submit"
              className="primary-button"
              disabled={submittingRequest}
            >
              {submittingRequest ? "Submitting…" : "Submit Refund Request"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowRequestForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Refunds History Table */}
      {refunds.length === 0 ? (
        <p className="muted" style={{ margin: "12px 0 0" }}>No refund requests recorded for this bill.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Refund ID</th>
                <th>Amount</th>
                <th>Destination</th>
                <th>Status</th>
                <th>Reason</th>
                <th className="align-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((refund) => (
                <tr key={refund.id}>
                  <td>
                    <span style={{ fontFamily: "monospace", fontSize: "11px" }}>{refund.id.slice(-8)}</span>
                  </td>
                  <td>
                    <strong>{refund.formattedAmount} USDC</strong>
                    {refund.fiatAmount && <span className="muted" style={{ display: "block", fontSize: "11px" }}>≈ ${refund.fiatAmount}</span>}
                  </td>
                  <td>
                    <span style={{ fontFamily: "monospace", fontSize: "11px" }} title={refund.destinationWallet}>
                      {refund.destinationWallet.slice(0, 4)}...{refund.destinationWallet.slice(-4)}
                    </span>
                    {refund.isDestinationOverridden && (
                      <span style={{ display: "block", fontSize: "10px", color: "#f6ad55" }}>Custom</span>
                    )}
                  </td>
                  <td>
                    <span className={`status status-${refund.status.toLowerCase()}`}>
                      {refund.status}
                    </span>
                    {refund.failureReason && (
                      <span style={{ display: "block", fontSize: "10px", color: "#fc8181" }}>{refund.failureReason}</span>
                    )}
                  </td>
                  <td style={{ maxWidth: "160px", fontSize: "12px" }}>
                    {refund.reason}
                  </td>
                  <td className="align-right">
                    {/* Owner approval actions */}
                    {isOwner && refund.status === "REQUESTED" && (
                      <div style={{ display: "inline-flex", gap: "6px" }}>
                        <button
                          type="button"
                          className="primary-button"
                          style={{ padding: "4px 8px", fontSize: "11px" }}
                          onClick={() => handleApprove(refund.id)}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          style={{ padding: "4px 8px", fontSize: "11px" }}
                          onClick={() => handleReject(refund.id)}
                        >
                          Reject
                        </button>
                      </div>
                    )}

                    {/* Owner signing action */}
                    {isOwner && refund.status === "APPROVED" && (
                      <div>
                        {activeSigningRefundId === refund.id ? (
                          <span style={{ fontSize: "11px", color: "#38bdf8" }}>{signingStatus}</span>
                        ) : (
                          <button
                            type="button"
                            className="primary-button"
                            style={{ padding: "4px 8px", fontSize: "11px" }}
                            onClick={() => handleSignAndSubmit(refund)}
                          >
                            Sign in Phantom
                          </button>
                        )}
                      </div>
                    )}

                    {/* Pending state */}
                    {refund.status === "PENDING" && (
                      <span style={{ fontSize: "11px", color: "#f6ad55" }}>
                        {refund.signature ? (
                          <a
                            href={`https://explorer.solana.com/tx/${refund.signature}?cluster=devnet`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "#38bdf8", textDecoration: "underline" }}
                          >
                            Verifying on chain…
                          </a>
                        ) : (
                          "Pending verification"
                        )}
                      </span>
                    )}

                    {/* Confirmed state */}
                    {refund.status === "CONFIRMED" && (
                      <div>
                        {refund.signature && (
                          <a
                            href={`https://explorer.solana.com/tx/${refund.signature}?cluster=devnet`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ fontSize: "11px", color: "#48bb78", textDecoration: "underline", display: "block" }}
                          >
                            View on Explorer
                          </a>
                        )}
                        <span style={{ fontSize: "10px", color: "#718096" }}>Settled to Ledger</span>
                      </div>
                    )}

                    {/* Failed state with retry */}
                    {isOwner && refund.status === "FAILED" && (
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ padding: "4px 8px", fontSize: "11px" }}
                        onClick={() => handleApprove(refund.id)}
                      >
                        Retry Approval
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
