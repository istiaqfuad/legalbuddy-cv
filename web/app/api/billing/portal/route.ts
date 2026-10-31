import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

/** Customer Portal session: upgrades, downgrades, cancellation, and
 * payment method updates are self-serve. Stripe redirects back to /chat. */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  try {
    const rows = (await getDb().query(
      "SELECT stripe_customer_id FROM users WHERE id = $1",
      [session.user.id],
    )) as Array<{ stripe_customer_id: string | null }>;
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return Response.json(
        { detail: "No subscription yet. Pick a plan first." },
        { status: 400 },
      );
    }
    const base = (process.env.NEXTAUTH_URL ?? "http://localhost:3001").replace(/\/$/, "");
    const portal = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${base}/chat`,
    });
    return Response.json({ url: portal.url });
  } catch (err) {
    console.error(`portal failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not open billing. Please try again." }, { status: 502 });
  }
}
