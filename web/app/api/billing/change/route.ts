import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStripe, priceIdFor } from "@/lib/stripe";

/** Switch an existing subscription between paid tiers (upgrade or
 * downgrade) without a new Checkout Session. Stripe prorates the swap;
 * a pending cancel is lifted so the plan continues. The webhook syncs
 * the local plan from `customer.subscription.updated`. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  let plan: string | null = null;
  try {
    plan = (await req.json())?.plan ?? null;
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  if (plan !== "starter" && plan !== "professional" && plan !== "business") {
    return Response.json({ detail: "Plan must be starter, professional, or business." }, { status: 400 });
  }
  let priceId: string;
  try {
    priceId = priceIdFor(plan);
  } catch (err) {
    console.error(`change config: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not change plans. Please try again." }, { status: 500 });
  }
  try {
    const db = getDb();
    const rows = (await db.query(
      "SELECT stripe_customer_id, plan FROM users WHERE id = $1",
      [session.user.id],
    )) as Array<{ stripe_customer_id: string | null; plan: string }>;
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return Response.json(
        { detail: "No subscription yet. Pick a plan first." },
        { status: 400 },
      );
    }
    const subs = await getStripe().subscriptions.list({ customer: customerId, limit: 5 });
    const sub = subs.data.find((s) => s.status === "active" || s.status === "trialing");
    if (!sub) {
      return Response.json(
        { detail: "No subscription yet. Pick a plan first." },
        { status: 400 },
      );
    }
    const itemId = sub.items.data[0]?.id;
    if (!itemId) throw new Error("subscription has no items");
    await getStripe().subscriptions.update(sub.id, {
      cancel_at_period_end: false,
      items: [{ id: itemId, price: priceId }],
      metadata: { user_id: session.user.id, plan },
    });
    return Response.json({ ok: true, plan });
  } catch (err) {
    console.error(`change failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not change plans. Please try again." }, { status: 502 });
  }
}
