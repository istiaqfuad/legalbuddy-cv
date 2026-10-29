import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;

let cached: Sql | null = null;

/** Neon HTTP client. Built lazily so `next build` never needs live env. */
export function getDb(): Sql {
  if (cached) return cached;
  const raw = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL || "";
  if (!raw) throw new Error("DATABASE_URL_POOLED is not set.");
  // The serverless driver's URL parser rejects channel_binding; the
  // pooled HTTP endpoint does not need it.
  const u = new URL(raw);
  u.searchParams.delete("channel_binding");
  cached = neon(u.toString());
  return cached;
}
