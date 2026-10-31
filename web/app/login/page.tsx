"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/logo";
import SiteHeader from "@/components/site-header";

type Mode = "signin" | "signup";
type Step = "who" | "details" | "plan";
type AccountType = "individual" | "business" | "lawyer";

const inputCls =
  "w-full rounded-md border border-stone-700 bg-stone-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none";

const cardCls = (on: boolean) =>
  `rounded-lg border p-4 text-left transition-colors ${
    on
      ? "border-gold bg-gold/10"
      : "border-stone-700 bg-stone-900/60 hover:border-stone-500"
  }`;

const WHO: Array<{ id: AccountType; title: string; body: string }> = [
  { id: "individual", title: "Individual", body: "Everyday legal questions, answered plainly." },
  { id: "business", title: "Business", body: "Contracts, compliance, and company paperwork." },
  { id: "lawyer", title: "Lawyer", body: "Cited research plus enrollment verification." },
];

const PLANS: Array<{ id: "lite" | "professional" | "business"; price: string; body: string }> = [
  { id: "lite", price: "Free", body: "Capped legal Q&A, full citations." },
  { id: "professional", price: "~$12.99/mo", body: "Unlimited cited research and case analysis." },
  { id: "business", price: "~$19.99/mo", body: "Drafting, trackers, and a company workspace." },
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(
    params.get("mode") === "signup" ? "signup" : "signin",
  );
  const [step, setStep] = useState<Step>("who");
  const [who, setWho] = useState<AccountType>("individual");
  const [plan, setPlan] = useState<"lite" | "professional" | "business">("lite");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
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
          body: JSON.stringify({
            name,
            email,
            password,
            accountType: who === "business" ? "business" : "individual",
            companyName: company,
            role: who === "lawyer" ? "lawyer" : "user",
            plan,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
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
      if (mode === "signup" && plan !== "lite") {
        const co = await fetch("/api/billing/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan }),
        });
        const coData = await co.json().catch(() => null);
        if (co.ok && typeof coData?.url === "string") {
          window.location.href = coData.url;
          return;
        }
        setError("Account created, but checkout failed. Pick a plan in Pricing.");
        return;
      }
      router.push(mode === "signup" && who === "lawyer" ? "/verify-lawyer" : "/chat");
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
                : step === "who"
                  ? "First, who is this account for?"
                  : step === "details"
                    ? "Your details stay private to your account."
                    : "Start free, upgrade when research becomes work."}
            </p>
          </div>

          <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-5">
            <button
              onClick={() => signIn("google", { callbackUrl: "/post-login" })}
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

            {mode === "signin" ? (
              <form onSubmit={submit} className="space-y-3">
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
                  placeholder="Password"
                  type="password"
                  autoComplete="current-password"
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
                  {busy ? "Please wait…" : "Sign in"}
                </button>
              </form>
            ) : step === "who" ? (
              <div className="space-y-2">
                {WHO.map((w) => (
                  <button key={w.id} onClick={() => setWho(w.id)} className={`${cardCls(who === w.id)} w-full`}>
                    <span className="block text-sm font-semibold text-stone-100">{w.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-stone-400">{w.body}</span>
                  </button>
                ))}
                <button
                  onClick={() => setStep("details")}
                  className="w-full rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.99]"
                >
                  Continue
                </button>
              </div>
            ) : step === "details" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setStep("plan");
                }}
                className="space-y-3"
              >
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  required
                  className={inputCls}
                />
                {who === "business" ? (
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Company name"
                    autoComplete="organization"
                    required
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
                  placeholder="Password (8+ characters)"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className={inputCls}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStep("who")}
                    className="rounded-md border border-stone-700 px-4 py-2 text-sm text-stone-300 transition-colors hover:border-stone-500"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.99]"
                  >
                    Continue
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={submit} className="space-y-2">
                {PLANS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlan(p.id)}
                    className={`${cardCls(plan === p.id)} w-full`}
                  >
                    <span className="flex items-baseline justify-between">
                      <span className="text-sm font-semibold text-stone-100 capitalize">{p.id}</span>
                      <span className="font-display text-lg text-gold-light">{p.price}</span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-stone-400">{p.body}</span>
                  </button>
                ))}
                {who === "lawyer" ? (
                  <p className="text-xs leading-relaxed text-stone-500">
                    After signup you will verify your Bar Council enrollment. The plan above still applies.
                  </p>
                ) : null}
                {error ? <p className="text-xs leading-relaxed text-red-300">{error}</p> : null}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setStep("details")}
                    className="rounded-md border border-stone-700 px-4 py-2 text-sm text-stone-300 transition-colors hover:border-stone-500"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="flex-1 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy ? "Please wait…" : plan === "lite" ? "Create free account" : `Continue to payment`}
                  </button>
                </div>
              </form>
            )}
          </div>

          <p className="mt-4 text-center text-sm text-stone-400">
            {mode === "signin" ? (
              <>
                New here?{" "}
                <button onClick={() => { setMode("signup"); setStep("who"); }} className="font-medium text-gold-light hover:underline">
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

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
