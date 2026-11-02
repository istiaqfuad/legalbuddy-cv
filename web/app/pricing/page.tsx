"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SiteHeader from "@/components/site-header";
import ConfirmModal from "@/components/confirm-modal";

type PlanId = "lite" | "starter" | "professional" | "business";

const RANK: Record<PlanId, number> = { lite: 0, starter: 1, professional: 2, business: 3 };

const TIERS: Array<{
  id: PlanId;
  name: string;
  price: string;
  per: string;
  badge?: string;
  blurb: string;
  points: string[];
}> = [
  {
    id: "lite",
    name: "Lite",
    price: "Free",
    per: "forever",
    blurb: "For a quick question now and then.",
    points: ["20 cited answers a day", "Full section citations", "Plain answers in your language"],
  },
  {
    id: "starter",
    name: "Starter",
    price: "~$5",
    per: "per month",
    badge: "Best first step",
    blurb: "For your first real matter, without the full commitment.",
    points: [
      "100 cited answers a day",
      "Everything in Lite",
      "Room to grow into Professional later",
    ],
  },
  {
    id: "professional",
    name: "Professional",
    price: "~$12.99",
    per: "per month",
    blurb: "For lawyers and anyone researching every day.",
    points: ["Unlimited cited research", "Case analysis and first drafts", "Lawyer directory profile"],
  },
  {
    id: "business",
    name: "Business",
    price: "~$19.99",
    per: "per month",
    blurb: "For companies with contracts and compliance on the line.",
    points: [
      "Everything in Professional",
      "Full contract drafting and risk checks",
      "License tracker and renewal checklists",
      "Secure workspace for company legal files",
    ],
  },
];

type Pending = { kind: "cancel" | "downgrade"; target: PlanId } | null;

/** Standalone pricing: signed-in users check out, change plans, or
 * cancel here. Downgrades and cancellations ask for confirmation first;
 * upgrades never do. Everyone else starts at signup with a plan picked. */
export default function PricingPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [plan, setPlan] = useState<PlanId>("lite");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refreshStatus() {
    try {
      const r = await fetch("/api/billing/status");
      if (r.ok) {
        const d = await r.json().catch(() => null);
        setSignedIn(true);
        if (typeof d?.plan === "string") setPlan(d.plan as PlanId);
      }
    } catch {
      // Keep the last known state; the next action retries.
    }
  }

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
            if (typeof d?.plan === "string") setPlan(d.plan as PlanId);
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

  /** Upgrade to a paid tier, or change between paid tiers. Downgrades
   * only reach here after the confirmation modal. */
  async function changePlan(id: Exclude<PlanId, "lite">) {
    if (busy) return;
    setBusy(id);
    setNotice(null);
    try {
      const endpoint = plan === "lite" ? "/api/billing/checkout" : "/api/billing/change";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: id }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && typeof data?.url === "string") {
        window.location.href = data.url;
        return;
      }
      if (res.ok) {
        await refreshStatus();
        setNotice(
          id === "starter" || RANK[id] < RANK[plan]
            ? `You are on ${TIERS[RANK[id]].name} now. The new quota applies right away.`
            : `You are on ${TIERS[RANK[id]].name} now.`,
        );
        return;
      }
      setNotice(typeof data?.detail === "string" ? data.detail : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  /** Cancel the subscription at the end of the billing period. Only
   * reached after the confirmation modal. */
  async function cancelSubscription() {
    if (busy) return;
    setBusy("lite");
    setNotice(null);
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        const end = typeof data?.currentPeriodEnd === "string" ? new Date(data.currentPeriodEnd) : null;
        setNotice(
          end
            ? `Canceled. Your paid plan stays on until ${end.toLocaleDateString()}, then you move to Lite.`
            : "Canceled. Your paid plan stays on until the end of the billing period, then you move to Lite.",
        );
        await refreshStatus();
        return;
      }
      setNotice(typeof data?.detail === "string" ? data.detail : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  /** One click on a tier card: upgrade directly, or open the confirm
   * modal for anything that takes value away. */
  function choose(id: PlanId) {
    if (busy || pending) return;
    if (RANK[id] > RANK[plan]) {
      void changePlan(id as Exclude<PlanId, "lite">);
      return;
    }
    if (id === "lite") {
      setPending({ kind: "cancel", target: id });
      return;
    }
    setPending({ kind: "downgrade", target: id });
  }

  function confirmPending() {
    if (!pending || busy) return;
    const p = pending;
    setPending(null);
    if (p.kind === "cancel") void cancelSubscription();
    else void changePlan(p.target as Exclude<PlanId, "lite">);
  }

  const pendingTier = pending ? TIERS[RANK[pending.target]] : null;
  const currentName = TIERS[RANK[plan]].name;

  return (
    <div className="min-h-screen bg-ink">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <p className="text-xs font-semibold tracking-widest text-gold-light uppercase">
          Business model and pricing
        </p>
        <h1 className="mt-2 font-display text-3xl text-stone-50">Simple Monthly Subscriptions</h1>
        <p className="mt-2 max-w-2xl text-sm text-stone-400">
          Start free. One matter to handle, start with Starter. Research every
          day, move up when the limits start pinching.
        </p>
        {notice ? (
          <p className="mt-4 rounded-md border border-stone-700 bg-stone-900/60 px-4 py-2.5 text-sm text-stone-200">
            {notice}
          </p>
        ) : null}
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {TIERS.map((t) => {
            const current = signedIn && plan === t.id;
            const isDowngradeTarget = signedIn && !current && RANK[t.id] < RANK[plan];
            return (
              <div
                key={t.id}
                className={`relative flex flex-col rounded-xl border p-6 ${
                  t.badge
                    ? "border-gold/70 bg-stone-900/60"
                    : "border-stone-800/80 bg-stone-900/40"
                }`}
              >
                {t.badge ? (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gold px-3 py-0.5 text-xs font-semibold whitespace-nowrap text-ink">
                    {t.badge}
                  </span>
                ) : null}
                <h2 className="text-xs font-semibold tracking-wider text-stone-300 uppercase">{t.name}</h2>
                <p className="mt-2">
                  <span className="font-display text-3xl text-stone-50">{t.price}</span>{" "}
                  <span className="text-xs text-stone-500">{t.per}</span>
                </p>
                <p className="mt-1 text-xs text-stone-500">{t.blurb}</p>
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
                    {t.id === "lite" ? "Start free" : `Start with ${t.name}`}
                  </Link>
                ) : (
                  <button
                    onClick={() => choose(t.id)}
                    disabled={busy !== null}
                    className="mt-5 rounded-md bg-gold px-4 py-2 text-center text-sm font-semibold text-ink transition-colors hover:bg-gold-light disabled:opacity-60"
                  >
                    {busy === t.id
                      ? "Please wait…"
                      : t.id === "lite"
                        ? "Cancel subscription"
                        : isDowngradeTarget
                          ? `Downgrade to ${t.name}`
                          : `Choose ${t.name}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-center text-xs text-stone-500">
          Cancel or downgrade anytime. Paid access stays on until the end of
          your billing period. Receipts and invoices live in Stripe.
        </p>
      </main>
      {pending && pendingTier ? (
        <ConfirmModal
          title={pending.kind === "cancel" ? `Cancel ${currentName}?` : `Downgrade to ${pendingTier.name}?`}
          body={
            pending.kind === "cancel"
              ? `Your ${currentName} subscription ends at the close of your current billing period. Until then nothing changes, and after that your account moves to Lite with 20 cited answers a day. You can come back anytime.`
              : `You move from ${currentName} to ${pendingTier.name} right away, with its lower daily quota. Stripe prorates the difference on your next invoice.`
          }
          confirmLabel={pending.kind === "cancel" ? "Yes, cancel" : `Yes, downgrade`}
          busy={busy !== null}
          onConfirm={confirmPending}
          onClose={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
