import Link from "next/link";

export default function NotFound() {
  return (
    <div className="landing" style={{ textAlign: "center" }}>
      <p className="eyebrow">404 NOT FOUND</p>
      <h1 style={{ fontSize: "clamp(32px, 6vw, 48px)", margin: "16px auto" }}>Page Not Found</h1>
      <p className="intro" style={{ margin: "0 auto 28px" }}>
        The requested bill, dashboard view, or resource does not exist or has been moved.
      </p>
      <div className="actions" style={{ justifyContent: "center" }}>
        <Link className="button" href="/dashboard">
          Return to Dashboard
        </Link>
        <Link className="secondary-button" href="/">
          Home
        </Link>
      </div>
    </div>
  );
}
