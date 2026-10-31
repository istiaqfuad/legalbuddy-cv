import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

/** Stripe webhook: the ONLY writer of billing state. Checkout, renewals,
 * failures, cancellations, disputes, and refunds all land here; the app
 * never trusts the success redirect or client input for plan state.
 * Fails closed: unverified signatures are rejected, unknown events are
 * logged and acked, handler errors return 500 so Stripe retries. */

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("webhook misconfigured: STRIPE_WEBHOOK_SECRET is not set.");
    return Response.json({ detail: "Billing is not configured." }, { status: 500 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ detail: "Missing signature." }, { status: 400 });
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch (err) {
    console.error(`webhook signature: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object as Stripe.Checkout.Session;
        // Async sessions can complete unpaid; only paid ones fulfill.
        if (s.payment_status !== "paid") break;
        if (s.mode === "subscription" && typeof s.subscription === "string") {
          await applySubscription(s.subscription, s.customer);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await applySubscription(sub.id, sub.customer);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const subId =
          typeof inv.parent?.subscription_details?.subscription === "string"
            ? inv.parent.subscription_details.subscription
            : null;
        if (subId) await applySubscription(subId, inv.customer);
        break;
      }
      // Risk side: a dispute, refund, or early fraud warning on a
      // subscription charge suspends the paid plan until resolved.
      case "charge.dispute.created":
      case "charge.refunded":
      case "radar.early_fraud_warning.created": {
        const subId = await subscriptionForEvent(event);
        if (subId) {
          await getDb().query(
            `UPDATE users SET subscription_status = 'disputed', updated_at = now()
             WHERE stripe_subscription_id = $1`,
            [subId],
          );
        }
        console.error(`billing risk: ${event.type} on subscription ${subId ?? "unknown"}`);
        break;
      }
      default:
        console.log(`webhook ignored: ${event.type}`);
    }
    return Response.json({ received: true });
  } catch (err) {
    console.error(`webhook handler: ${err instanceof Error ? err.message : err}`);
    // 500 so Stripe retries instead of silently dropping fulfillment.
    return Response.json({ detail: "Handler failed." }, { status: 500 });
  }
}

/** Resolve a plan from the subscription's price, falling back to the
 * metadata stamped at checkout. Unknown prices keep the Lite default. */
async function planFor(subscription: Stripe.Subscription): Promise<"professional" | "business" | "lite"> {
  const priceId = subscription.items.data[0]?.price.id;
  if (priceId === process.env.STRIPE_PRICE_BUSINESS) return "business";
  if (priceId === process.env.STRIPE_PRICE_PROFESSIONAL) return "professional";
  const meta = (subscription.metadata?.plan ?? "").toLowerCase();
  if (meta === "business" || meta === "professional") return meta;
  return "lite";
}

async function applySubscription(subscriptionId: string, customer: unknown) {
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const customerId = typeof customer === "string" ? customer : (subscription.customer as string);
  const plan = await planFor(subscription);
  const status = subscription.status;
  await getDb().query(
    `UPDATE users SET plan = $1, subscription_status = $2,
       stripe_subscription_id = $3, stripe_customer_id = $4, updated_at = now()
     WHERE stripe_customer_id = $4 OR id::text = $5`,
    [
      plan,
      status,
      subscription.id,
      customerId,
      subscription.metadata?.user_id ?? "",
    ],
  );
}

/** Walk the object graph from a risk event to the affected subscription. */
async function subscriptionForEvent(event: Stripe.Event): Promise<string | null> {
  const obj = event.data.object as { invoice?: unknown; charge?: unknown; payment_intent?: unknown };
  const stripe = getStripe();
  const invoiceId =
    typeof obj.invoice === "string"
      ? obj.invoice
      : typeof obj.payment_intent === "string"
        ? (await stripe.paymentIntents.retrieve(obj.payment_intent) as unknown as { invoice?: unknown }).invoice ?? null
        : null;
  const resolvedInvoiceId = typeof invoiceId === "string" ? invoiceId : null;
  if (!resolvedInvoiceId) return null;
  const invoice = await stripe.invoices.retrieve(resolvedInvoiceId);
  const sub = invoice.parent?.subscription_details?.subscription;
  return typeof sub === "string" ? sub : null;
}
