import Stripe from "stripe";

/** Stripe client singleton (server-side only). API version pinned to the
 * latest per integration guidance; webhooks verify against the same SDK. */
let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  cached = new Stripe(key, { apiVersion: "2026-10-28.endive" });
  return cached;
}

export type Plan = "lite" | "starter" | "professional" | "business";

/** Paid tiers cheapest-first: used to tell upgrades from downgrades. */
export const PLAN_RANK: Record<Plan, number> = {
  lite: 0,
  starter: 1,
  professional: 2,
  business: 3,
};

export const PLANS: Record<
  Exclude<Plan, "lite">,
  { name: string; amount: string; envKey: string }
> = {
  starter: { name: "Starter", amount: "~$5/mo", envKey: "STRIPE_PRICE_STARTER" },
  professional: { name: "Professional", amount: "~$12.99/mo", envKey: "STRIPE_PRICE_PROFESSIONAL" },
  business: { name: "Business", amount: "~$19.99/mo", envKey: "STRIPE_PRICE_BUSINESS" },
};

export function priceIdFor(plan: Exclude<Plan, "lite">): string {
  const id = process.env[PLANS[plan].envKey];
  if (!id) throw new Error(`${PLANS[plan].envKey} is not set. Run web/scripts/stripe-setup.mjs.`);
  return id;
}

/** Paid-and-current: the only states that unlock unlimited answers. */
export function subscriptionActive(status: string | null): boolean {
  return status === "active" || status === "trialing";
}
