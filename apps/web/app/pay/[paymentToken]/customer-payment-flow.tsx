"use client";

import { useEffect, useState, useCallback } from "react";
import {
  DEVNET_NETWORK,
  DEVNET_USDC_MINT,
  getPhantomProvider,
  isValidSolanaAddress,
  shortenAddress,
} from "../../../lib/solana";
import {
  buildUsdcPaymentTransaction,
  generateReference,
  SOLANA_RPC_URL,
  type PaymentStep,
} from "../../../lib/payment";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export type Quote = {
  id: string;
  fiatAmount: string;
  fiatCurrency: string;
  rate: string;
  cryptoAmount: string;
  feeAmount: string;
  totalCryptoAmount: string;
  cryptoUnits: string;
  feeUnits: string;
  feeBps: number;
  tokenMint: string;
  tokenSymbol: string;
  tokenDecimals: number;
  network?: string;
  merchantSettlementAddress?: string | null;
  merchantRecipient?: string | null;
  feeRecipient?: string | null;
  isSettlementConfigured?: boolean;
  expiresAt: string;
  status: "ACTIVE" | "EXPIRED";
};

interface CustomerPaymentFlowProps {
  paymentToken: string;
  merchantName: string;
  merchantSettlementAddress: string | null;
  isSettlementConfigured: boolean;
  currency: string;
  total: string;
}

const STEP_LABELS: Record<PaymentStep, string> = {
  idle: "",
  preparing: "Preparing transaction…",
  approving: "Waiting for Phantom approval…",
  submitting: "Submitting to Solana Devnet…",
  pending: "Submitted — verifying on Solana Devnet…",
  confirmed: "Payment Verified & Settled!",
  review: "Payment Under Merchant Review",
  failed: "Payment failed",
  rejected: "Cancelled in Phantom",
};

export function CustomerPaymentFlow({
  paymentToken,
  merchantName,
  merchantSettlementAddress,
  isSettlementConfigured,
  currency,
  total,
}: CustomerPaymentFlowProps) {
  // Quote State
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Wallet State
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [phantomAvailable, setPhantomAvailable] = useState<boolean | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [merchantCopied, setMerchantCopied] = useState(false);

  // Payment State
  const [payStep, setPayStep] = useState<PaymentStep>("idle");
  const [payError, setPayError] = useState("");
  const [payResult, setPayResult] = useState<{ signature: string; attemptId: string } | null>(null);
  const [verifiedDetails, setVerifiedDetails] = useState<{
    status?: string;
    reviewReason?: string | null;
    verifiedAt?: string;
    blockTime?: string | null;
  } | null>(null);

  // Check Phantom availability on mount & setup event listeners
  useEffect(() => {
    const provider = getPhantomProvider();
    setPhantomAvailable(Boolean(provider));

    if (provider) {
      if (provider.isConnected && provider.publicKey) {
        const pk = provider.publicKey.toString();
        if (isValidSolanaAddress(pk)) {
          setWalletAddress(pk);
        }
      }

      const handleConnect = (pk: { toString(): string }) => {
        const addr = pk.toString();
        if (isValidSolanaAddress(addr)) {
          setWalletAddress(addr);
          setWalletError("");
        }
      };

      const handleDisconnect = () => {
        setWalletAddress(null);
        setPayStep("idle");
        setPayResult(null);
      };

      const handleAccountChanged = (pk: { toString(): string } | null) => {
        if (pk) {
          const addr = pk.toString();
          if (isValidSolanaAddress(addr)) {
            setWalletAddress(addr);
            setPayStep("idle");
            setPayResult(null);
          }
        } else {
          setWalletAddress(null);
        }
      };

      provider.on("connect", handleConnect);
      provider.on("disconnect", handleDisconnect);
      provider.on("accountChanged", handleAccountChanged);

      return () => {
        provider.removeListener("connect", handleConnect);
        provider.removeListener("disconnect", handleDisconnect);
        provider.removeListener("accountChanged", handleAccountChanged);
      };
    }
  }, []);

  // Countdown timer for active quote
  useEffect(() => {
    if (!quote) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((new Date(quote.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setQuote((prev) => (prev ? { ...prev, status: "EXPIRED" } : null));
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [quote]);

  // Phase 7: Poll payment verification status while in "pending" state
  useEffect(() => {
    if (payStep !== "pending" || !quote?.id) return;

    let isSubscribed = true;
    const pollInterval = window.setInterval(async () => {
      try {
        const resp = await fetch(`${API}/public/pay/${encodeURIComponent(paymentToken)}/attempt/${encodeURIComponent(quote.id)}`);
        if (!resp.ok) return;
        const res = await resp.json();
        const data = res.data?.attempt;
        if (!data || !isSubscribed) return;

        if (data.isPaid || data.verified?.status === "CONFIRMED") {
          setVerifiedDetails(data.verified || { status: "CONFIRMED" });
          setPayStep("confirmed");
          clearInterval(pollInterval);
        } else if (
          data.verified?.status === "PARTIAL" ||
          data.verified?.status === "OVERPAID" ||
          data.verified?.status === "LATE" ||
          data.billStatus === "PAYMENT_REVIEW"
        ) {
          setVerifiedDetails(data.verified || { status: data.billStatus, reviewReason: data.verified?.reviewReason });
          setPayStep("review");
          clearInterval(pollInterval);
        } else if (data.verified?.status === "FAILED") {
          setPayError(data.verified.reviewReason || "Transaction failed on-chain.");
          setPayStep("failed");
          clearInterval(pollInterval);
        }
      } catch {
        // Transient network error while polling; retry on next tick
      }
    }, 2500);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
    };
  }, [payStep, quote?.id, paymentToken]);

  // Request a fresh quote without touching the wallet state
  const requestQuote = useCallback(async () => {
    setQuoteLoading(true);
    setQuoteError("");
    setPayStep("idle");
    setPayResult(null);
    setPayError("");
    try {
      const response = await fetch(`${API}/public/pay/${encodeURIComponent(paymentToken)}/quotes`, {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not create a quote.");
      setQuote(result.data.quote as Quote);
    } catch (e) {
      setQuoteError(e instanceof Error ? e.message : "Could not create a quote.");
    } finally {
      setQuoteLoading(false);
    }
  }, [paymentToken]);

  // Connect Phantom wallet without touching the quote state
  async function connectWallet() {
    const provider = getPhantomProvider();
    if (!provider) {
      window.open("https://phantom.app/", "_blank", "noopener,noreferrer");
      setWalletError("Phantom wallet extension not detected. Please install Phantom to continue.");
      return;
    }

    setWalletLoading(true);
    setWalletError("");
    try {
      const resp = await provider.connect();
      const addr = resp.publicKey.toString();
      if (isValidSolanaAddress(addr)) {
        setWalletAddress(addr);
      } else {
        throw new Error("Invalid public address returned by Phantom.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection request was rejected in Phantom";
      setWalletError(msg);
    } finally {
      setWalletLoading(false);
    }
  }

  // Disconnect wallet
  async function disconnectWallet() {
    const provider = getPhantomProvider();
    if (provider) {
      try { await provider.disconnect(); } catch { /* ignore */ }
    }
    setWalletAddress(null);
    setPayStep("idle");
    setPayResult(null);
  }

  function copyText(text: string, isMerchant: boolean) {
    navigator.clipboard.writeText(text).then(() => {
      if (isMerchant) {
        setMerchantCopied(true);
        setTimeout(() => setMerchantCopied(false), 2000);
      } else {
        setAddressCopied(true);
        setTimeout(() => setAddressCopied(false), 2000);
      }
    });
  }

  // Execute payment: build, sign, submit
  async function executePayment() {
    if (!quote || !walletAddress) return;

    const merchantRecipient = quote.merchantRecipient ?? quote.merchantSettlementAddress;
    const feeRecipient = quote.feeRecipient ?? null;

    if (!merchantRecipient || !isValidSolanaAddress(merchantRecipient)) {
      setPayError("Merchant recipient address is not set or invalid. Please refresh the page.");
      return;
    }

    const cryptoUnits = BigInt(quote.cryptoUnits);
    const feeUnits = BigInt(quote.feeUnits);

    if (feeUnits > BigInt(0) && (!feeRecipient || !isValidSolanaAddress(feeRecipient))) {
      setPayError("Fee recipient is missing for this quote. Please contact the merchant.");
      return;
    }

    const provider = getPhantomProvider();
    if (!provider || !provider.publicKey) {
      setPayError("Phantom wallet is not connected. Please reconnect.");
      return;
    }

    setPayError("");
    setPayStep("preparing");

    try {
      // Generate a unique Solana Pay reference pubkey
      const reference = generateReference();

      // Build the transaction (also verifies Devnet genesis hash)
      let transaction;
      let _connection;
      try {
        const built = await buildUsdcPaymentTransaction({
          customerWallet: walletAddress,
          merchantRecipient,
          feeRecipient,
          cryptoUnits,
          feeUnits,
          reference,
          rpcUrl: SOLANA_RPC_URL,
        });
        transaction = built.transaction;
        _connection = built.connection;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to build transaction";
        setPayError(msg);
        setPayStep("failed");
        return;
      }

      // Show approval step and ask Phantom to sign+send
      setPayStep("approving");
      let signature: string;
      try {
        const result = await provider.signAndSendTransaction(transaction, { skipPreflight: false });
        signature = result.signature;
      } catch (err: unknown) {
        // User rejected
        const code = (err as { code?: number })?.code;
        if (code === 4001 || (err instanceof Error && err.message?.toLowerCase().includes("user rejected"))) {
          setPayStep("rejected");
          setPayError("You cancelled the transaction in Phantom.");
        } else {
          setPayStep("failed");
          setPayError(err instanceof Error ? err.message : "Transaction failed in Phantom.");
        }
        return;
      }

      // Submit to our API — record as PENDING (never PAID here)
      setPayStep("submitting");
      try {
        const response = await fetch(`${API}/public/pay/${encodeURIComponent(paymentToken)}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quoteId: quote.id,
            reference,
            signature,
            customerWallet: walletAddress,
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          // If 409 idempotent (already submitted), treat as success
          if (response.status === 409 && result.data?.attempt) {
            setPayResult({ signature, attemptId: result.data.attempt.id });
            setPayStep("pending");
            return;
          }
          throw new Error(result.message || "Failed to record payment submission.");
        }
        setPayResult({ signature, attemptId: result.data.attempt.id });
        setPayStep("pending");
      } catch (err) {
        // If API recording fails, the transaction may already be on-chain
        // We still show the signature so the user can track it
        setPayResult({ signature, attemptId: "" });
        setPayStep("failed");
        setPayError(
          `Transaction submitted to Solana (${signature.slice(0, 8)}...) but could not be recorded. Please contact support with your signature.`
        );
      }
    } catch (err) {
      setPayStep("failed");
      setPayError(err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  }

  const effectiveSettlement = quote?.merchantRecipient ?? quote?.merchantSettlementAddress ?? merchantSettlementAddress;
  const isSettlementValid = Boolean(effectiveSettlement && isValidSolanaAddress(effectiveSettlement));
  const isQuoteActive = quote && quote.status === "ACTIVE" && secondsLeft > 0;
  const canPay =
    isQuoteActive &&
    walletAddress &&
    isSettlementValid &&
    payStep === "idle" &&
    payResult === null;

  const explorerBase = "https://explorer.solana.com/tx/";

  return (
    <div className="payment-flow-container">
      {/* SECTION 1: LIVE DEVNET USDC QUOTE */}
      <section className="payment-card quote-section" aria-labelledby="quote-heading">
        <div className="section-header">
          <div>
            <span className="section-tag">STEP 1</span>
            <h2 id="quote-heading" className="section-title">Devnet USDC Rate</h2>
          </div>
          <span className="network-pill">
            <span className="pulse-dot" />
            Solana Devnet
          </span>
        </div>

        {!isQuoteActive ? (
          <div className="quote-prompt">
            <p className="muted">
              Get an exact, time-locked USDC conversion for this {currency} {total} bill before connecting your wallet.
            </p>
            <button
              className="primary-button quote-btn"
              type="button"
              disabled={quoteLoading}
              onClick={requestQuote}
            >
              {quoteLoading
                ? "Fetching Devnet rate…"
                : quote
                ? "Get new 120-second quote"
                : "Lock live USDC price"}
            </button>
          </div>
        ) : (
          <div className="active-quote-box">
            <div className="quote-timer-bar">
              <span className="timer-badge">
                ⏱ Locked for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
              </span>
              <button
                type="button"
                className="refresh-quote-link"
                onClick={requestQuote}
                disabled={quoteLoading}
              >
                {quoteLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            <div className="quote-amounts-grid">
              <div className="amount-col">
                <span className="amount-label">Base Amount</span>
                <span className="amount-value">{quote.cryptoAmount} USDC</span>
                <span className="amount-fiat">{quote.fiatCurrency} {quote.fiatAmount}</span>
              </div>
              <div className="amount-col">
                <span className="amount-label">Platform Fee ({(quote.feeBps / 100).toFixed(2)}%)</span>
                <span className="amount-value">{quote.feeAmount} USDC</span>
                <span className="amount-fiat">Direct on-chain</span>
              </div>
              <div className="amount-col highlight-col">
                <span className="amount-label">Total Due</span>
                <strong className="amount-value total-crypto">{quote.totalCryptoAmount} USDC</strong>
                <span className="amount-fiat">1 USDC = {quote.fiatCurrency} {quote.rate}</span>
              </div>
            </div>

            <div className="mint-verification">
              <span>Verified Devnet Mint:</span>
              <code className="quote-mint">{quote.tokenMint}</code>
            </div>
          </div>
        )}

        {quoteError && <p className="form-error" role="alert">{quoteError}</p>}
      </section>

      {/* SECTION 2: SOLANA DEVNET PHANTOM WALLET */}
      <section className="payment-card wallet-section" aria-labelledby="wallet-heading">
        <div className="section-header">
          <div>
            <span className="section-tag">STEP 2</span>
            <h2 id="wallet-heading" className="section-title">Phantom Wallet (Devnet)</h2>
          </div>
          {walletAddress && (
            <span className="connected-pill">
              <span className="pulse-dot green" />
              Connected
            </span>
          )}
        </div>

        {phantomAvailable === false ? (
          <div className="wallet-unsupported-box" role="alert">
            <div className="phantom-icon-badge">👻</div>
            <div className="wallet-prompt-text">
              <strong>Phantom Extension Not Detected</strong>
              <p className="muted">
                Install Phantom browser extension to connect your wallet on Solana Devnet.
              </p>
            </div>
            <a
              href="https://phantom.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button install-phantom-btn"
            >
              Install Phantom
            </a>
          </div>
        ) : !walletAddress ? (
          <div className="wallet-connect-box">
            <p className="muted">
              Connect your Phantom wallet on Solana Devnet to verify address and prepare for payment.
            </p>
            <div className="wallet-safety-note">
              🔒 Non-custodial: We never request your seed phrase or private keys. Funds go directly to the merchant.
            </div>
            <button
              className="primary-button phantom-connect-btn"
              type="button"
              disabled={walletLoading}
              onClick={connectWallet}
            >
              <span className="phantom-ghost">👻</span>
              {walletLoading ? "Connecting to Phantom…" : "Connect Phantom Wallet"}
            </button>
          </div>
        ) : (
          <div className="connected-wallet-box">
            <div className="wallet-info-row">
              <div className="wallet-label-group">
                <span className="wallet-row-title">CUSTOMER WALLET (YOU)</span>
                <span className="wallet-address-chip" title={walletAddress}>
                  {shortenAddress(walletAddress, 6)}
                </span>
              </div>
              <div className="wallet-row-actions">
                <button
                  type="button"
                  className="copy-pill-btn"
                  onClick={() => copyText(walletAddress, false)}
                >
                  {addressCopied ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  className="secondary-button disconnect-btn"
                  onClick={disconnectWallet}
                  disabled={payStep === "approving" || payStep === "submitting"}
                >
                  Disconnect
                </button>
              </div>
            </div>

            <div className="full-address-preview">
              <code>{walletAddress}</code>
            </div>

            <div className="devnet-status-banner">
              <span className="network-indicator">● Solana Devnet</span>
              <span className="network-instruction">
                Ensure Phantom is in <strong>Settings → Developer Settings → Testnet Mode (Devnet)</strong>
              </span>
            </div>

            {/* Recipient verification */}
            <div className="recipient-preview-card">
              <div className="recipient-header">
                <span>SETTLEMENT RECIPIENT ({merchantName})</span>
                {effectiveSettlement && (
                  <button
                    type="button"
                    className="copy-pill-btn mini"
                    onClick={() => copyText(effectiveSettlement, true)}
                  >
                    {merchantCopied ? "Copied!" : "Copy"}
                  </button>
                )}
              </div>
              {isSettlementValid ? (
                <div className="recipient-address-valid">
                  <code>{effectiveSettlement}</code>
                  <span className="verified-badge">✓ Verified Devnet Merchant Address</span>
                </div>
              ) : (
                <div className="recipient-address-missing" role="alert">
                  ⚠️ Merchant has not yet configured a Solana Devnet settlement address.
                </div>
              )}
            </div>
          </div>
        )}

        {walletError && <p className="form-error" role="alert">{walletError}</p>}
      </section>

      {/* SECTION 3: PAY NOW */}
      <section className="payment-card pay-section" aria-labelledby="pay-heading">
        <div className="section-header">
          <div>
            <span className="section-tag">STEP 3</span>
            <h2 id="pay-heading" className="section-title">Confirm & Pay</h2>
          </div>
        </div>

        {/* Phase 7: Payment confirmed & settled on-chain */}
        {payStep === "confirmed" && (
          <div className="pay-success-box confirmed-settled-box" role="status">
            <div className="pay-success-icon">🎉</div>
            <div className="pay-success-content">
              <strong className="confirmed-heading">Payment Verified & Settled!</strong>
              <p className="muted">
                Your payment of <strong>{quote?.totalCryptoAmount} USDC</strong> has been independently verified on-chain at finalized commitment. This bill is now <strong>PAID</strong>.
              </p>
              <div className="confirmed-badge-row">
                <span className="badge-confirmed">✓ Finalized on Solana Devnet</span>
                {verifiedDetails?.verifiedAt && (
                  <span className="verified-time">
                    Verified: {new Date(verifiedDetails.verifiedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
              {payResult?.signature && (
                <div className="pay-sig-row">
                  <span className="pay-sig-label">Signature:</span>
                  <code className="pay-sig-code">{payResult.signature.slice(0, 20)}…</code>
                  <a
                    href={`${explorerBase}${payResult.signature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pay-explorer-link"
                  >
                    View on Solana Explorer ↗
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase 7: Payment under merchant review */}
        {payStep === "review" && (
          <div className="pay-review-box" role="status">
            <div className="pay-review-icon">⚠️</div>
            <div className="pay-review-content">
              <strong className="review-heading">Payment Under Merchant Review</strong>
              <p className="muted">
                Your payment transaction was detected on-chain, but requires merchant confirmation:
              </p>
              {verifiedDetails?.reviewReason && (
                <div className="review-reason-box">
                  <code>{verifiedDetails.reviewReason}</code>
                </div>
              )}
              <p className="muted">
                The merchant has received this transaction evidence and will update your bill status shortly.
              </p>
              {payResult?.signature && (
                <div className="pay-sig-row">
                  <span className="pay-sig-label">Signature:</span>
                  <code className="pay-sig-code">{payResult.signature.slice(0, 20)}…</code>
                  <a
                    href={`${explorerBase}${payResult.signature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pay-explorer-link"
                  >
                    View on Solana Explorer ↗
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Payment result — pending verification */}
        {payStep === "pending" && payResult && (
          <div className="pay-success-box" role="status">
            <div className="pay-success-icon">✅</div>
            <div className="pay-success-content">
              <strong>Transaction Submitted!</strong>
              <p className="muted">
                Your USDC payment has been signed and submitted to Solana Devnet.
                It is now awaiting on-chain confirmation. This may take 15–30 seconds.
              </p>
              <div className="pay-sig-row">
                <span className="pay-sig-label">Signature:</span>
                <code className="pay-sig-code">{payResult.signature.slice(0, 20)}…</code>
                <a
                  href={`${explorerBase}${payResult.signature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pay-explorer-link"
                >
                  View on Explorer ↗
                </a>
              </div>
              <div className="pay-pending-note">
                ⏳ Payment verification is in progress. The bill status will update automatically once confirmed.
              </div>
            </div>
          </div>
        )}

        {/* Rejected */}
        {payStep === "rejected" && (
          <div className="pay-rejected-box" role="alert">
            <div className="pay-fail-icon">✕</div>
            <div>
              <strong>Cancelled</strong>
              <p className="muted">You cancelled the transaction in Phantom. Your funds were not moved.</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => { setPayStep("idle"); setPayError(""); }}
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* Failed */}
        {payStep === "failed" && (
          <div className="pay-failed-box" role="alert">
            <div className="pay-fail-icon">⚠</div>
            <div>
              <strong>Payment Failed</strong>
              {payError && <p className="form-error">{payError}</p>}
              {!payResult && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => { setPayStep("idle"); setPayError(""); }}
                >
                  Try again
                </button>
              )}
              {payResult && (
                <a
                  href={`${explorerBase}${payResult.signature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pay-explorer-link"
                >
                  Check transaction on Solana Explorer ↗
                </a>
              )}
            </div>
          </div>
        )}

        {/* In-progress steps */}
        {(payStep === "preparing" || payStep === "approving" || payStep === "submitting") && (
          <div className="pay-progress-box" role="status">
            <div className="pay-spinner" aria-hidden="true" />
            <div className="pay-progress-content">
              <strong>{STEP_LABELS[payStep]}</strong>
              {payStep === "approving" && (
                <p className="muted">Check Phantom — it needs your approval to proceed.</p>
              )}
              {payStep === "submitting" && (
                <p className="muted">Broadcasting your signed transaction to Solana Devnet…</p>
              )}
            </div>
          </div>
        )}

        {/* Idle — show Pay button or prerequisites */}
        {payStep === "idle" && payResult === null && (
          <div className="pay-idle-box">
            {!walletAddress && (
              <p className="muted pay-prereq">Connect your Phantom wallet in Step 2 to continue.</p>
            )}
            {walletAddress && !isQuoteActive && (
              <p className="muted pay-prereq">Get a price quote in Step 1 to continue.</p>
            )}
            {walletAddress && isQuoteActive && !isSettlementValid && (
              <p className="muted pay-prereq">
                Merchant has not configured a settlement address. Contact them to enable payments.
              </p>
            )}

            {canPay && quote && (
              <div className="pay-confirmation-panel">
                <div className="pay-confirm-header">Review Payment</div>
                <div className="pay-confirm-rows">
                  <div className="pay-confirm-row">
                    <span>To (Merchant)</span>
                    <code>{shortenAddress(effectiveSettlement ?? "", 8)}</code>
                  </div>
                  <div className="pay-confirm-row">
                    <span>Merchant receives</span>
                    <strong>{quote.cryptoAmount} USDC</strong>
                  </div>
                  {Number(quote.feeUnits) > 0 && (
                    <div className="pay-confirm-row">
                      <span>Platform fee ({(quote.feeBps / 100).toFixed(2)}%)</span>
                      <strong>{quote.feeAmount} USDC</strong>
                    </div>
                  )}
                  <div className="pay-confirm-row pay-confirm-total">
                    <span>You send (total)</span>
                    <strong className="pay-total-amount">{quote.totalCryptoAmount} USDC</strong>
                  </div>
                  <div className="pay-confirm-row">
                    <span>Network</span>
                    <span className="network-pill mini">Solana Devnet</span>
                  </div>
                  <div className="pay-confirm-row">
                    <span>Token</span>
                    <span>USDC (Devnet) · 6 decimals</span>
                  </div>
                </div>
                <div className="pay-safety-note">
                  🔒 Funds go directly from your wallet to the merchant. CryptoPOS never holds your funds.
                </div>
                <button
                  type="button"
                  className="primary-button pay-now-btn"
                  onClick={executePayment}
                >
                  <span className="phantom-ghost">👻</span>
                  Pay {quote.totalCryptoAmount} USDC via Phantom
                </button>
                <p className="muted pay-timer-note">
                  Quote expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} — payment will use this locked rate.
                </p>
              </div>
            )}
          </div>
        )}

        {payError && payStep === "idle" && (
          <p className="form-error" role="alert">{payError}</p>
        )}
      </section>
    </div>
  );
}
