"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Client Error Boundary caught error:", error);
  }, [error]);

  return (
    <div className="landing" style={{ textAlign: "center" }}>
      <p className="eyebrow" style={{ color: "#ff8c8c" }}>SOMETHING WENT WRONG</p>
      <h1 style={{ fontSize: "clamp(28px, 5vw, 42px)", margin: "16px auto" }}>Application Error</h1>
      <p className="intro" style={{ margin: "0 auto 28px" }}>
        An unexpected error occurred. Your funds and on-chain payment statuses remain safe and verified on Solana Devnet.
      </p>
      <div className="actions" style={{ justifyContent: "center" }}>
        <button className="button" onClick={() => reset()} type="button">
          Try Again
        </button>
        <Link className="secondary-button" href="/dashboard">
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
