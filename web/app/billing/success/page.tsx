"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Logo from "@/components/logo";
import SiteHeader from "@/components/site-header";

/** After Checkout: the webhook (not this page) owns fulfillment, so poll
 * the plan until it flips, then move on. Never trust the redirect alone. */
export default function BillingSuccessPage() {
  const router = useRouter();
  const [state, setState] = useState<"waiting" | "ready" | "stuck">("waiting");
  const [role, setRole] = useState("user");

  useEffect(() => {
    let live = true;
    let tries = 0;
    const tick = async () => {
      if (!live) return;
      tries += 1;
      try {
        const res = await fetch("/api/billing/status");
        const d = res.ok ? await res.json() : null;
        if (d && (d.plan === "professional" || d.plan === "business")) {
          setRole(typeof d.role === "string" ? d.role : "user");
          setState("ready");
          return;
        }
      } catch {
        // Keep polling; the webhook may still be in flight.
      }
      if (tries >= 20) {
        if (live) setState("stuck");
        return;
      }
      setTimeout(tick, 3000);
    };
    tick();
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <div className="flex justify-center">
            <Logo size={44} />
          </div>
          <h1 className="mt-4 font-display text-2xl text-stone-100">
            {state === "ready" ? "Payment confirmed" : state === "stuck" ? "Still confirming" : "Confirming payment…"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-400">
            {state === "ready"
              ? "Your plan is active. Research without limits."
              : state === "stuck"
                ? "Confirmation is taking longer than usual. Your plan activates automatically once payment clears."
                : "Waiting for the payment confirmation to arrive."}
          </p>
          {state === "ready" ? (
            <button
              onClick={() => {
                router.push(role === "lawyer" ? "/verify-lawyer" : "/chat");
                router.refresh();
              }}
              className="mt-6 w-full rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.99]"
            >
              Start researching
            </button>
          ) : state === "stuck" ? (
            <Link
              href="/chat"
              className="mt-6 block rounded-md border border-stone-700 px-4 py-2 text-sm text-stone-200 transition-colors hover:border-stone-500"
            >
              Go to chat anyway
            </Link>
          ) : null}
        </div>
      </main>
    </div>
  );
}
