"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const registering = mode === "register";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    try {
      const response = await fetch(`${API}/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to sign in");
      router.replace("/dashboard");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed. Check the API is running.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell">
    <a className="brand" href="/">CryptoPOS</a>
    <section className="auth-card">
      <p className="eyebrow">MERCHANT ACCOUNT</p>
      <h1>{registering ? "Create your business account" : "Welcome back"}</h1>
      <p className="muted">{registering ? "Start with a Devnet-ready merchant profile." : "Sign in to your merchant workspace."}</p>
      <form onSubmit={submit} className="auth-form">
        {registering && <label>Your name<input name="name" required minLength={2} maxLength={80} autoComplete="name" /></label>}
        <label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
        <label>Password<input name="password" type="password" required minLength={registering ? 12 : 1} maxLength={128} autoComplete={registering ? "new-password" : "current-password"} />{registering && <small>Use at least 12 characters.</small>}</label>
        {registering && <>
          <label>Business name<input name="businessName" required minLength={2} maxLength={120} autoComplete="organization" /></label>
          <label>Business type <span className="optional">Optional</span><input name="businessType" maxLength={80} placeholder="Retail, cafe, services…" /></label>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button form-button" disabled={busy}>{busy ? "Please wait…" : registering ? "Create account" : "Sign in"}</button>
      </form>
      <p className="switch-auth">{registering ? "Already have an account?" : "New to CryptoPOS?"} <a href={registering ? "/login" : "/register"}>{registering ? "Sign in" : "Create account"}</a></p>
    </section>
    <p className="note auth-note">CryptoPOS never asks for wallet seed phrases or private keys.</p>
  </main>;
}
