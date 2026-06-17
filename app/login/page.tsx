"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const params = useSearchParams();
  const verified = params.get("verify") === "1";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await signIn("email", { email, callbackUrl: "/" });
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0f172a",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "sans-serif",
    }}>
      <div style={{
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: 12,
        padding: "40px 48px",
        width: 360,
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}>
        <div style={{ textAlign: "center" }}>
          <span style={{ fontFamily: "Bangers, cursive", fontSize: 32, letterSpacing: 3, color: "#3b82f6" }}>
            COMIC FORGE
          </span>
          <p style={{ color: "#94a3b8", fontSize: 14, marginTop: 8 }}>
            Sign in to your account
          </p>
        </div>

        {verified ? (
          <div style={{
            background: "#1d4ed820",
            border: "1px solid #1d4ed8",
            borderRadius: 8,
            padding: "12px 16px",
            color: "#93c5fd",
            fontSize: 14,
            textAlign: "center",
          }}>
            Check your email (or the server console in dev) for a magic link.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              type="email"
              required
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={{
                padding: "10px 14px",
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                color: "#e2e8f0",
                fontSize: 14,
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "10px",
                background: loading ? "#1e3a8a" : "#1d4ed8",
                border: "none",
                borderRadius: 8,
                color: "#e2e8f0",
                fontSize: 14,
                fontFamily: "Bangers, cursive",
                letterSpacing: 1,
                cursor: loading ? "default" : "pointer",
              }}
            >
              {loading ? "Sending…" : "Send Magic Link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
