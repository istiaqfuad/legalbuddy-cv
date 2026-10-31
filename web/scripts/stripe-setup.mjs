#!/usr/bin/env node
/** Creates the LegalBuddy product catalog in Stripe (test or live, matching
 * the key) and prints the monthly Price IDs for .env:
 *
 *   node web/scripts/stripe-setup.mjs
 *
 * Idempotent by lookup: existing products/prices with the same lookup keys
 * are reused, so re-running never duplicates the catalog. One Product per
 * plan (names stay distinct on Checkout and invoices).
 */
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envPath = join(root, ".env");
if (!process.env.STRIPE_SECRET_KEY && existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || m[1] in process.env) continue;
    let v = m[2].trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is not set.");
  process.exit(1);
}

const { default: Stripe } = await import("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-10-28.endive",
});

const CATALOG = [
  { key: "professional", name: "LegalBuddy Professional", amount: 1299, memo: "Cited legal research and case analysis for lawyers and professionals." },
  { key: "business", name: "LegalBuddy Business", amount: 1999, memo: "Contract drafting, compliance tracking, and a workspace for company legal files." },
];

/** Find or create the monthly price for one plan. */
async function ensurePrice(entry) {
  const lookupKey = `legalbuddy_${entry.key}_monthly`;
  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (existing.data.length > 0) return existing.data[0];
  const products = await stripe.products.list({ limit: 100 });
  let product = products.data.find((p) => p.name === entry.name && p.active);
  if (!product) {
    product = await stripe.products.create({ name: entry.name, description: entry.memo });
    console.log(`product created: ${product.id} (${entry.name})`);
  }
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: entry.amount,
    currency: "usd",
    recurring: { interval: "month" },
    lookup_key: lookupKey,
  });
  console.log(`price created: ${price.id} (${entry.name})`);
  return price;
}

const ids = {};
for (const entry of CATALOG) {
  const price = await ensurePrice(entry);
  ids[entry.key] = price.id;
}
console.log("\nAdd to .env:");
console.log(`STRIPE_PRICE_PROFESSIONAL=${ids.professional}`);
console.log(`STRIPE_PRICE_BUSINESS=${ids.business}`);
