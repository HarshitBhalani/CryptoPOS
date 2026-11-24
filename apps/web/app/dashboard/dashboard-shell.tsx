"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiData } from "../../lib/api";
import { Account, DashboardContext, Merchant } from "./dashboard-context";

const baseLinks = [
  ["/dashboard", "Overview"],
  ["/dashboard/pos", "New payment"],
  ["/dashboard/bills", "Bills"],
  ["/dashboard/analytics", "Analytics"],
  ["/dashboard/settings", "Business settings"],
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<Account | null>(null);
  const [merchantId, setMerchantId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    apiData<{ user: Account }>("/auth/me").then(({ user: account }) => {
      if (!account.merchants.length) throw new Error("No merchant access is assigned to this account.");
      setUser(account);
      const saved = localStorage.getItem("cryptopos_merchant_id");
      setMerchantId(account.merchants.some((item) => item.id === saved) ? saved! : account.merchants[0].id);
    }).catch(() => router.replace("/login"));
  }, [router]);

  const merchant = user?.merchants.find((item) => item.id === merchantId);

  const links = user?.role === "PLATFORM_ADMIN"
    ? [...baseLinks, ["/admin", "Platform Admin"]]
    : baseLinks;

  useEffect(() => {
    if (merchantId) localStorage.setItem("cryptopos_merchant_id", merchantId);
  }, [merchantId]);

  async function logout() {
    try { await apiData<null>("/auth/logout", { method: "POST" }); } catch { /* Clear the local view even if the API is offline. */ }
    router.replace("/login");
  }

  if (!user || !merchant) return <main className="dashboard-loading"><span className="spinner" />{error || "Loading your business…"}</main>;
  return <DashboardContext.Provider value={{ user, merchant, setMerchantId }}>
    <div className="dashboard-frame">
      <aside className="sidebar">
        <a className="brand" href="/">CryptoPOS</a>
        <p className="sidebar-label">WORKSPACE</p>
        <nav>{links.map(([href, label]) => <a className={pathname === href ? "nav-link active" : "nav-link"} href={href} key={href}>{label}</a>)}</nav>
        <div className="sidebar-foot"><span className="devnet-dot" />Solana Devnet</div>
      </aside>
      <section className="dashboard-main">
        <header className="topbar">
          <label className="business-select-label">Business
            <select value={merchant.id} onChange={(event) => setMerchantId(event.target.value)} aria-label="Select business">
              {user.merchants.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </label>
          <div className="profile"><span>{user.name}</span><button className="secondary-button" onClick={logout}>Sign out</button></div>
        </header>
        <main className="dashboard-content">{children}</main>
      </section>
    </div>
  </DashboardContext.Provider>;
}
