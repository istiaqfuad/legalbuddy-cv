#!/usr/bin/env node
/** Applies db/schema.sql to the Neon database. No dependencies beyond
 * @neondatabase/serverless; reads the repo .env itself so no shell
 * sourcing is needed.
 *
 *   node scripts/db-migrate.mjs            # uses ../.env DATABASE_URL
 *   DATABASE_URL=... node scripts/db-migrate.mjs   # explicit override
 */
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envPath = join(root, ".env");
if (!process.env.DATABASE_URL && existsSync(envPath)) {
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
// Pooled connection first: the serverless driver speaks HTTP and the
// pooled URL is the one shaped for it (no channel_binding parameter).
const databaseUrl = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Neither DATABASE_URL_POOLED nor DATABASE_URL is set.");
  process.exit(1);
}

const scrub = (s) => String(s).replace(/postgresql:\/\/[^@\s]+@[^\s'"]+/g, "postgresql://<redacted>");

function toNeonUrl(raw) {
  // The serverless driver's URL parser rejects channel_binding; the
  // pooled HTTP endpoint does not need it. Keep everything else intact.
  const u = new URL(raw);
  u.searchParams.delete("channel_binding");
  return u.toString();
}
try {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(toNeonUrl(databaseUrl));
  const schema = readFileSync(join(root, "web", "db", "schema.sql"), "utf8");
  // The HTTP driver prepares each query: multi-statement strings are
  // rejected, so apply statement-by-statement (schema has no function
  // bodies, plain semicolon splitting is safe).
  const statements = schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await sql.query(stmt);
  }
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`;
  console.log("migrated OK:", tables.map((t) => t.tablename).join(", "));
} catch (err) {
  console.error("migration failed:", scrub(err && err.message ? err.message : err));
  process.exit(1);
}
