"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/logo";
import SiteHeader from "@/components/site-header";

type Mode = "signin" | "signup";

const inputCls =
  "w-full rounded-md border border-stone-700 bg-stone-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(
            typeof data?.detail === "string"
              ? data.detail
              : "Could not create the account. Please try again.",
          );
          return;
        }
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError("Those details do not match any account. Check them and try again.");
        return;
      }
      router.push("/chat");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <Logo size={44} />
            <h1 className="font-display text-2xl text-stone-100">
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-sm leading-relaxed text-stone-400">
              {mode === "signin"
                ? "Sign in to pick up your past conversations."
                : "Save every conversation and pick up where you left off."}
            </p>
          </div>

          <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-5">
            <button
              onClick={() => signIn("google", { callbackUrl: "/chat" })}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm font-medium text-stone-100 transition-colors hover:border-stone-500"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M21.35 11.1H12v2.9h5.35c-.5 2.4-2.55 3.5-5.35 3.5a5.9 5.9 0 0 1 0-11.8c1.5 0 2.85.55 3.9 1.45l2.1-2.1A8.9 8.9 0 0 0 12 3a9 9 0 0 0 0 18c5 0 8.55-3.5 8.55-8.55 0-.45-.05-.9-.2-1.35Z"
                />
              </svg>
              Continue with Google
            </button>

            <div className="my-4 flex items-center gap-3 text-[11px] text-stone-500">
              <span className="h-px flex-1 bg-stone-800" />
              or with email
              <span className="h-px flex-1 bg-stone-800" />
            </div>

            <form onSubmit={submit} className="space-y-3">
              {mode === "signup" ? (
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  className={inputCls}
                />
              ) : null}
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                type="email"
                autoComplete="email"
                required
                className={inputCls}
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={8}
                className={inputCls}
              />
              {error ? <p className="text-xs leading-relaxed text-red-300">{error}</p> : null}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>
          </div>

          <p className="mt-4 text-center text-sm text-stone-400">
            {mode === "signin" ? (
              <>
                New here?{" "}
                <button onClick={() => setMode("signup")} className="font-medium text-gold-light hover:underline">
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button onClick={() => setMode("signin")} className="font-medium text-gold-light hover:underline">
                  Sign in
                </button>
              </>
            )}
          </p>
          <p className="mt-6 text-center text-xs text-stone-500">
            <Link href="/" className="hover:text-stone-300">
              Back to home
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
