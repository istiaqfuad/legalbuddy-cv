# Neon connectivity

## Symptom

`@neondatabase/serverless` failed from both the sandbox and Docker with
`fetch failed` / `ETIMEDOUT`, while Qdrant, Voyage, and Baseten all worked.

## Root cause

Two separate issues, found by probing layer by layer:

1. The driver does not talk to the pooler host in the connection string. It
   POSTs to the regional gateway `https://api.c-6.us-east-2.aws.neon.tech/sql`.
   Pinning only the pooler hostname (`--add-host`) changed nothing; tracing
   the driver's actual `fetch` calls exposed the real host.
2. The sandbox/Node fetch path stalls on IPv6 routes to Neon (AAAA records
   resolve, TCP never completes, Happy Eyeballs never falls back). Raw
   `tls.connect` to each A record with SNI succeeds, and `POST /sql`
   against a pinned IPv4 address answers immediately.

## Fix

- `docker-compose.yml` pins the gateway to a working IPv4 address via
  `extra_hosts`. If Neon rotates IPs and the web container starts failing
  with `fetch failed`, re-resolve `api.c-6.us-east-2.aws.neon.tech` and
  update the pin.
- `web/scripts/db-migrate.mjs` applies `schema.sql` statement by statement:
  the HTTP driver prepares each query, so multi-statement strings are
  rejected with `cannot insert multiple commands into a prepared statement`.
- The same script strips `channel_binding` from the URL (the driver's URL
  parser rejects it) and strips surrounding quotes/`&amp;` entities that
  sneak in from copy-pasted `.env` values.
- Diagnose with: raw `tls.connect` per resolved IP (proves L4/LB health),
  then `POST https://<gateway>/sql` (proves the HTTP endpoint), then the
  driver with a fetch wrapper logging request URLs (proves which host the
  driver actually uses).
