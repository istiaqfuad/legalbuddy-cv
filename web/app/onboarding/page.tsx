"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/logo";
import SiteHeader from "@/components/site-header";

type AccountType = "individual" | "business" | "lawyer";

const inputCls =
  "w-full rounded-md border border-stone-700 bg-stone-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none";

const cardCls = (on: boolean) =>
  `rounded-lg border p-4 text-left transition-colors ${
    on ? "border-gold bg-gold/10" : "border-stone-700 bg-stone-900/60 hover:border-stone-500"
  }`;

/** Finishes Google signups: account type, company, plan. Email signups
 * already did this inline on /login. */
export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [who, setWho] = useState<AccountType>("individual");
  const [company, setCompany] = useState("");
  const [plan, setPlan] = useState<"lite" | "professional" | "business">("lite");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/billing/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        if (!d) {
          router.replace("/login");
          return;
        }
        if (d.onboarded) {
          router.replace("/post-login");
          return;
        }
        setLoading(false);
      })
      .catch(() => live && router.replace("/login"));
    return () => {
      live = false;
    };
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountType: who === "business" ? "business" : "individual",
          companyName: company,
          role: who === "lawyer" ? "lawyer" : "user",
          plan,
          onboarded: true,
        }),
      });
      if (!res.ok) {
        setError("Could not save your details. Please try again.");
        return;
      }
      if (plan !== "lite") {
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
        setError("Details saved, but checkout failed. Pick a plan in Pricing.");
        return;
      }
      router.push(who === "lawyer" ? "/verify-lawyer" : "/chat");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-ink">
        <SiteHeader />
        <main className="flex flex-1 items-center justify-center">
          <p className="text-sm text-stone-500">Setting up your account…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div className="flex flex-col items-center gap-3 text-center">
            <Logo size={44} />
            <h1 className="font-display text-2xl text-stone-100">Almost done</h1>
            <p className="text-sm leading-relaxed text-stone-400">
              Tell us who this account is for, then pick a plan.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["individual", "business", "lawyer"] as const).map((w) => (
              <button key={w} type="button" onClick={() => setWho(w)} className={`${cardCls(who === w)} px-2 py-3 text-center`}>
                <span className="block text-sm font-semibold text-stone-100 capitalize">{w}</span>
              </button>
            ))}
          </div>
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
          <div className="space-y-2">
            {(
              [
                { id: "lite", price: "Free", body: "Capped legal Q&A, full citations." },
                { id: "professional", price: "~$12.99/mo", body: "Unlimited cited research." },
                { id: "business", price: "~$19.99/mo", body: "Drafting, trackers, workspace." },
              ] as const
            ).map((p) => (
              <button key={p.id} type="button" onClick={() => setPlan(p.id)} className={`${cardCls(plan === p.id)} w-full`}>
                <span className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-stone-100 capitalize">{p.id}</span>
                  <span className="font-display text-lg text-gold-light">{p.price}</span>
                </span>
                <span className="mt-0.5 block text-xs text-stone-400">{p.body}</span>
              </button>
            ))}
          </div>
          {error ? <p className="text-xs leading-relaxed text-red-300">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Please wait…" : plan === "lite" ? "Start chatting free" : "Continue to payment"}
          </button>
        </form>
      </main>
    </div>
  );
}
