"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/site-header";

const TIERS = [
  {
    id: "lite" as const,
    name: "Lite · Individuals",
    price: "Free",
    per: "forever",
    points: ["Capped legal Q&A", "Full section citations", "Plain answers in your language"],
  },
  {
    id: "professional" as const,
    name: "Professional · Lawyers",
    price: "~$12.99",
    per: "per month",
    points: ["Unlimited cited legal research", "Case analysis and first drafts", "Lawyer directory profile"],
  },
  {
    id: "business" as const,
    name: "Business",
    price: "~$19.99",
    per: "per month",
    points: ["Full contract drafting and risk checks", "License tracker and renewal checklists", "Secure workspace for company legal files"],
  },
];

/** Standalone pricing: signed-in users check out or downgrade here;
 * everyone else starts at signup with the plan preselected after. */
export default function PricingPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [plan, setPlan] = useState("lite");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Only a finished request settles the buttons: 200 signs in, 401
    // signs out. A network failure retries, then holds the neutral state
    // instead of guessing signed-out (which is exactly the flash we are
    // removing).
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch("/api/billing/status");
          if (!live) return;
          if (r.ok) {
            const d = await r.json().catch(() => null);
            setSignedIn(true);
            setPlan(typeof d?.plan === "string" ? d.plan : "lite");
          }
          setLoaded(r.ok || r.status === 401);
          return;
        } catch {
          if (!live) return;
          await new Promise((res) => setTimeout(res, 1000));
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function choose(id: "lite" | "professional" | "business") {
    if (busy) return;
    setBusy(id);
    try {
      if (id === "lite") {
        const res = await fetch("/api/user", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: "lite" }),
        });
        if (res.ok) setPlan("lite");
        return;
      }
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: id }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && typeof data?.url === "string") window.location.href = data.url;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-ink">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <p className="text-xs font-semibold tracking-widest text-gold-light uppercase">
          Business model and pricing
        </p>
        <h1 className="mt-2 font-display text-3xl text-stone-50">Simple Monthly Subscriptions</h1>
        <p className="mt-2 text-sm text-stone-400">Start free. Pay only when research becomes work.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => {
            const current = signedIn && plan === t.id;
            return (
              <div
                key={t.id}
                className={`flex flex-col rounded-xl border p-6 ${
                  t.id === "business"
                    ? "border-emerald-800 bg-emerald-950/60"
                    : "border-stone-800/80 bg-stone-900/40"
                }`}
              >
                <h2 className="text-xs font-semibold tracking-wider text-stone-300 uppercase">{t.name}</h2>
                <p className="mt-2">
                  <span className="font-display text-3xl text-stone-50">{t.price}</span>{" "}
                  <span className="text-xs text-stone-500">{t.per}</span>
                </p>
                <ul className="mt-4 flex-1 space-y-2 text-sm text-stone-300">
                  {t.points.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span aria-hidden className="text-gold">✓</span> {p}
                    </li>
                  ))}
                </ul>
                {!loaded ? (
                  <span className="mt-5 rounded-md border border-stone-800 bg-stone-900/40 px-4 py-2 text-center text-sm text-stone-600 motion-safe:animate-pulse">
                    …
                  </span>
                ) : current ? (
                  <span className="mt-5 rounded-md border border-stone-700 px-4 py-2 text-center text-sm text-stone-400">
                    Current plan
                  </span>
                ) : !signedIn ? (
                  <Link
                    href="/login"
                    className="mt-5 rounded-md bg-gold px-4 py-2 text-center text-sm font-semibold text-ink transition-colors hover:bg-gold-light"
                  >
                    {t.id === "lite" ? "Start free" : `Choose ${t.id}`}
                  </Link>
                ) : (
                  <button
                    onClick={() => choose(t.id)}
                    disabled={busy !== null}
                    className="mt-5 rounded-md bg-gold px-4 py-2 text-center text-sm font-semibold text-ink transition-colors hover:bg-gold-light disabled:opacity-60"
                  >
                    {busy === t.id ? "Please wait…" : t.id === "lite" ? "Downgrade to free" : `Choose ${t.id}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-center text-xs text-stone-500">
          Manage or cancel anytime from billing. Receipts and invoices live in Stripe.
        </p>
      </main>
    </div>
  );
}
