import { randomBytes } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStripe, priceIdFor } from "@/lib/stripe";

const GENERIC_ERROR = "Could not start checkout. Please try again.";

/** Start a subscription Checkout Session for professional/business.
 * Creates (and stores) the Stripe Customer on first use. Fulfillment
 * happens in the webhook, never on the success redirect. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  let plan: string | null = null;
  try {
    plan = (await req.json())?.plan ?? null;
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  if (plan !== "professional" && plan !== "business") {
    return Response.json({ detail: "Plan must be professional or business." }, { status: 400 });
  }
  let priceId: string;
  try {
    priceId = priceIdFor(plan);
  } catch (err) {
    console.error(`checkout config: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
  try {
    const db = getDb();
    const rows = (await db.query(
      "SELECT stripe_customer_id, email FROM users WHERE id = $1",
      [session.user.id],
    )) as Array<{ stripe_customer_id: string | null; email: string }>;
    let customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: rows[0].email,
        metadata: { user_id: session.user.id },
      });
      customerId = customer.id;
      await db.query("UPDATE users SET stripe_customer_id = $1 WHERE id = $2", [
        customerId,
        session.user.id,
      ]);
    }
    const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3001").replace(/\/$/, "");
    // integration_identifier labels this flow in the Dashboard (dahlia+).
    const checkout = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { user_id: session.user.id, plan } },
      success_url: `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing`,
      integration_identifier: `legalbuddy-${randomBytes(4).toString("hex")}`,
    });
    if (!checkout.url) throw new Error("no checkout url");
    return Response.json({ url: checkout.url });
  } catch (err) {
    console.error(`checkout failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 502 });
  }
}
