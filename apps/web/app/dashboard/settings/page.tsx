"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiData } from "../../../lib/api";
import { useDashboard } from "../dashboard-context";
import {
  DEVNET_NETWORK,
  DEVNET_USDC_MINT,
  DEVNET_USDC_SYMBOL,
  getPhantomProvider,
  isValidSolanaAddress,
  shortenAddress,
} from "../../../lib/solana";

type MerchantSettings = {
  id: string;
  name: string;
  businessType?: string | null;
  status: string;
  settlementAddr?: string | null;
  settlementWallet?: {
    address: string | null;
    network: string;
    isConfigured: boolean;
    token: {
      symbol: string;
      name: string;
      mint: string;
      decimals: number;
      network: string;
    };
  };
  createdAt: string;
};

export default function BusinessSettingsPage() {
  const { merchant } = useDashboard();
  const [settings, setSettings] = useState<MerchantSettings | null>(null);
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [settlementAddress, setSettlementAddress] = useState("");
  const [error, setError] = useState("");
  const [walletError, setWalletError] = useState("");
  const [saved, setSaved] = useState(false);
  const [walletSaved, setWalletSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [phantomConnecting, setPhantomConnecting] = useState(false);

  useEffect(() => {
    apiData<{ merchant: MerchantSettings }>(`/merchants/${merchant.id}`)
      .then(({ merchant: value }) => {
        setSettings(value);
        setName(value.name);
        setBusinessType(value.businessType ?? "");
        setSettlementAddress(value.settlementAddr ?? "");
      })
      .catch((reason) => setError(reason.message));
  }, [merchant.id]);

  const isAddressValid = settlementAddress.trim().length === 0 || isValidSolanaAddress(settlementAddress.trim());
  const isAddressConfigured = Boolean(settings?.settlementAddr);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await apiData<{ merchant: MerchantSettings }>(`/merchants/${merchant.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, businessType }),
      });
      setSettings(result.merchant);
      setName(result.merchant.name);
      setBusinessType(result.merchant.businessType ?? "");
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  }

  async function saveWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = settlementAddress.trim();
    if (!trimmed) {
      setWalletError("Please enter a valid Solana Devnet settlement address or click Remove Wallet");
      return;
    }
    if (!isValidSolanaAddress(trimmed)) {
      setWalletError("Invalid address: must be a valid 32-byte base58 Solana public key");
      return;
    }

    setWalletBusy(true);
    setWalletError("");
    setWalletSaved(false);
    try {
      const result = await apiData<{ wallet: { settlementAddress: string; network: string; isConfigured: boolean } }>(
        `/merchants/${merchant.id}/wallet`,
        {
          method: "PUT",
          body: JSON.stringify({ settlementAddress: trimmed }),
        }
      );
      setSettings((prev) => (prev ? { ...prev, settlementAddr: result.wallet.settlementAddress } : null));
      setSettlementAddress(result.wallet.settlementAddress);
      setWalletSaved(true);
    } catch (reason) {
      setWalletError(reason instanceof Error ? reason.message : "Could not save settlement wallet");
    } finally {
      setWalletBusy(false);
    }
  }

  async function removeWallet() {
    if (!confirm("Remove the settlement wallet? You will not be able to receive customer payments until a new address is configured.")) {
      return;
    }
    setWalletBusy(true);
    setWalletError("");
    setWalletSaved(false);
    try {
      await apiData(`/merchants/${merchant.id}/wallet`, { method: "DELETE" });
      setSettings((prev) => (prev ? { ...prev, settlementAddr: null } : null));
      setSettlementAddress("");
      setWalletSaved(true);
    } catch (reason) {
      setWalletError(reason instanceof Error ? reason.message : "Could not remove settlement wallet");
    } finally {
      setWalletBusy(false);
    }
  }

  async function connectPhantom() {
    const provider = getPhantomProvider();
    if (!provider) {
      window.open("https://phantom.app/", "_blank", "noopener,noreferrer");
      setWalletError("Phantom wallet extension not detected. Please install Phantom from https://phantom.app");
      return;
    }

    setPhantomConnecting(true);
    setWalletError("");
    try {
      const resp = await provider.connect();
      const pubkey = resp.publicKey.toString();
      if (isValidSolanaAddress(pubkey)) {
        setSettlementAddress(pubkey);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection rejected by user in Phantom";
      setWalletError(msg);
    } finally {
      setPhantomConnecting(false);
    }
  }

  function copyAddress() {
    if (!settings?.settlementAddr) return;
    navigator.clipboard.writeText(settings.settlementAddr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (merchant.role !== "OWNER") {
    return (
      <section className="panel">
        <p className="eyebrow">BUSINESS SETTINGS</p>
        <h1>Owner access required</h1>
        <p className="muted">Your cashier role does not allow viewing or modifying business settlement settings.</p>
      </section>
    );
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">BUSINESS & WALLET SETTINGS</p>
          <h1>Settings & Settlement</h1>
          <p className="muted">Manage {merchant.name}&apos;s profile and Solana Devnet settlement destination.</p>
        </div>
      </div>

      <div className="settings-grid">
        {/* Left Column: Business Profile */}
        <section className="panel">
          <h2>Business Profile</h2>
          <p className="muted">Basic business information displayed on customer payment links.</p>
          <form className="settings-form" onSubmit={saveProfile}>
            <label>
              Business name
              <input
                required
                minLength={2}
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              Business type <span className="optional">Optional</span>
              <input
                maxLength={80}
                value={businessType}
                onChange={(event) => setBusinessType(event.target.value)}
                placeholder="Retail, cafe, services…"
              />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            {saved && <p className="success-message" role="status">Business profile saved successfully.</p>}
            <button className="button" type="submit" disabled={busy || !settings}>
              {busy ? "Saving…" : "Save profile"}
            </button>
          </form>
        </section>

        {/* Right Column: Settlement Wallet */}
        <section className="panel settings-wallet-panel">
          <div className="panel-header-with-badge">
            <h2>Settlement Wallet</h2>
            <span className={`network-badge ${isAddressConfigured ? "configured" : "unconfigured"}`}>
              <span className="pulse-dot" />
              {isAddressConfigured ? "Devnet Active" : "Action Required"}
            </span>
          </div>

          <p className="muted">
            All customer bill payments are transferred non-custodially to your merchant-controlled wallet on Solana Devnet.
          </p>

          {isAddressConfigured ? (
            <div className="current-wallet-card">
              <div className="wallet-card-header">
                <span className="wallet-card-label">CURRENT RECEIVING ADDRESS</span>
                <button
                  type="button"
                  className="copy-pill-btn"
                  onClick={copyAddress}
                  title="Copy full public address"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="wallet-address-full" title={settings?.settlementAddr ?? ""}>
                {settings?.settlementAddr}
              </div>
              <div className="wallet-card-meta">
                <span>Network: <strong>Solana {DEVNET_NETWORK}</strong></span>
                <span>Token: <strong>{DEVNET_USDC_SYMBOL} (6 decimals)</strong></span>
              </div>
            </div>
          ) : (
            <div className="warning-callout" role="alert">
              <strong>No settlement wallet configured</strong>
              <span>
                You must configure a Solana Devnet address before customers can complete payments on your bills.
              </span>
            </div>
          )}

          <form className="settings-form" onSubmit={saveWallet}>
            <label>
              {isAddressConfigured ? "Update settlement address" : "Configure Devnet settlement address"}
              <div className="input-with-action">
                <input
                  required
                  placeholder="Paste base58 Solana Devnet public key…"
                  value={settlementAddress}
                  onChange={(e) => {
                    setSettlementAddress(e.target.value);
                    setWalletError("");
                    setWalletSaved(false);
                  }}
                  className={
                    settlementAddress.trim().length > 0
                      ? isAddressValid
                        ? "input-valid"
                        : "input-invalid"
                      : ""
                  }
                />
                <button
                  type="button"
                  className="secondary-button autofill-btn"
                  onClick={connectPhantom}
                  disabled={phantomConnecting}
                  title="Connect Phantom to fill your address automatically"
                >
                  {phantomConnecting ? "Connecting…" : "Fill from Phantom"}
                </button>
              </div>
            </label>

            {settlementAddress.trim().length > 0 && (
              <p
                className={`validation-hint ${isAddressValid ? "hint-valid" : "hint-invalid"}`}
                role="status"
              >
                {isAddressValid
                  ? "✓ Valid 32-byte Solana public key"
                  : "✗ Invalid Solana public key (must be valid 32-byte base58)"}
              </p>
            )}

            {walletError && <p className="form-error" role="alert">{walletError}</p>}
            {walletSaved && <p className="success-message" role="status">Settlement wallet settings saved.</p>}

            <div className="wallet-actions">
              <button
                className="button"
                type="submit"
                disabled={walletBusy || !settlementAddress.trim() || !isAddressValid}
              >
                {walletBusy ? "Saving…" : isAddressConfigured ? "Update wallet" : "Save wallet"}
              </button>
              {isAddressConfigured && (
                <button
                  className="secondary-button danger-button"
                  type="button"
                  onClick={removeWallet}
                  disabled={walletBusy}
                >
                  Remove wallet
                </button>
              )}
            </div>
          </form>

          <div className="token-specs-card">
            <h4>Devnet Configuration Specs</h4>
            <div className="spec-row">
              <span className="spec-name">Network</span>
              <span className="spec-value">Solana Devnet</span>
            </div>
            <div className="spec-row">
              <span className="spec-name">Settlement Token</span>
              <span className="spec-value">Circle USD Coin ({DEVNET_USDC_SYMBOL})</span>
            </div>
            <div className="spec-row">
              <span className="spec-name">Decimals</span>
              <span className="spec-value">6 (Smallest unit: 0.000001 USDC)</span>
            </div>
            <div className="spec-row">
              <span className="spec-name">Devnet Mint</span>
              <code className="spec-mint">{DEVNET_USDC_MINT}</code>
            </div>
            <div className="security-notice">
              🔒 <strong>Non-Custodial Architecture:</strong> CryptoPOS never asks for, handles, or stores private keys or seed phrases.
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
