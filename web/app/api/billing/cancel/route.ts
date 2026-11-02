import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

/** Find the user's currently billing subscription, if any. */
async function activeSubscription(customerId: string) {
  const stripe = getStripe();
  const subs = await stripe.subscriptions.list({ customer: customerId, limit: 5 });
  return subs.data.find((s) => s.status === "active" || s.status === "trialing") ?? null;
}

/** Cancel at the end of the billing period: the user keeps paid access
 * until then, and the webhook flips the plan to Lite when the
 * subscription actually ends. Never flips the local plan here; Stripe
 * is the source of truth and the webhook is its only writer. */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  try {
    const rows = (await getDb().query("SELECT stripe_customer_id FROM users WHERE id = $1", [
      session.user.id,
    ])) as Array<{ stripe_customer_id: string | null }>;
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return Response.json({ detail: "There is no subscription to cancel." }, { status: 400 });
    }
    const sub = await activeSubscription(customerId);
    if (!sub) {
      return Response.json({ detail: "There is no active subscription to cancel." }, { status: 400 });
    }
    const updated = await getStripe().subscriptions.update(sub.id, {
      cancel_at_period_end: true,
    });
    // Newer API versions carry the period end on the item, not the subscription.
    const periodEnd =
      updated.items.data[0]?.current_period_end ?? sub.items.data[0]?.current_period_end;
    return Response.json({
      ok: true,
      currentPeriodEnd:
        typeof periodEnd === "number" ? new Date(periodEnd * 1000).toISOString() : null,
    });
  } catch (err) {
    console.error(`cancel failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not cancel. Please try again." }, { status: 502 });
  }
}
