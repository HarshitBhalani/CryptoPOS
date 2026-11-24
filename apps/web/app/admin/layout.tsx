"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { apiData } from "../../lib/api";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    apiData<{ user: AdminUser }>("/auth/me")
      .then(({ user }) => {
        if (user.role !== "PLATFORM_ADMIN") {
          setForbidden(true);
        } else {
          setUser(user);
        }
        setLoading(false);
      })
      .catch(() => {
        router.replace("/login");
      });
  }, [router]);

  async function handleLogout() {
    try {
      await apiData<null>("/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    router.replace("/login");
  }

  if (loading) {
    return (
      <main className="dashboard-loading">
        <span className="spinner" />
        Loading Platform Admin…
      </main>
    );
  }

  if (forbidden) {
    return (
      <main className="dashboard-loading" style={{ flexDirection: "column", gap: 16 }}>
        <h2 style={{ color: "#ff8c8c" }}>Access Denied</h2>
        <p className="muted">You do not have PLATFORM_ADMIN privileges to access this area.</p>
        <Link className="button" href="/dashboard">
          Return to Dashboard
        </Link>
      </main>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 75% 5%, #15263a 0, var(--bg) 50%)" }}>
      <header
        style={{
          borderBottom: "1px solid var(--line)",
          background: "var(--panel)",
          padding: "16px 32px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Link href="/admin" style={{ fontSize: 20, fontWeight: 800, textDecoration: "none", color: "var(--text)" }}>
            CryptoPOS <span style={{ color: "var(--green)", fontSize: 13, fontWeight: 600 }}>ADMIN</span>
          </Link>
          <span
            style={{
              background: "#281d09",
              border: "1px solid #7a5416",
              color: "#ffb84d",
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 4,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            Solana Devnet
          </span>
        </div>

        <nav style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/admin"
            className={pathname === "/admin" ? "button" : "secondary-button"}
            style={{ fontSize: 13, minHeight: 36, padding: "8px 14px" }}
          >
            Platform Overview
          </Link>
          <Link
            href="/dashboard"
            className="secondary-button"
            style={{ fontSize: 13, minHeight: 36, padding: "8px 14px" }}
          >
            Merchant App
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: 12 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{user?.email}</span>
            <button
              onClick={handleLogout}
              className="secondary-button"
              style={{ fontSize: 13, minHeight: 36, padding: "8px 12px" }}
              type="button"
            >
              Sign out
            </button>
          </div>
        </nav>
      </header>

      <main style={{ maxWidth: 1200, margin: "32px auto", padding: "0 24px" }}>
        {children}
      </main>
    </div>
  );
}
