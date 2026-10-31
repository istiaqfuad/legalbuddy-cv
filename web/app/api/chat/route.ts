import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { subscriptionActive } from "@/lib/stripe";

/** Server-side proxy: browser -> Next route -> Python API.
 *
 * The Python API (Voyage + Qdrant + Baseten keys) is never exposed to the
 * browser. `API_INTERNAL_URL` points at it inside compose
 * (`http://api:8000`) and defaults to localhost for `npm run dev`.
 * Reasoning models are slow: allow up to 3 minutes for the full stream.
 *
 * Error contract: the browser only ever sees GENERIC_ERROR. Upstream
 * status codes, exception text, and tracebacks stay in server logs.
 * Upstream speaks SSE; this route relays the byte stream untouched.
 */

const UPSTREAM_TIMEOUT_MS = 180_000;
const GENERIC_ERROR = "The assistant is unavailable right now. Please try again in a moment.";

/** Lite plan: capped assistant answers per UTC day. Paid plans with an
 * active or trialing subscription are unlimited; anything else (past
 * due, canceled, disputed) falls back to Lite. Quota failures stay
 * permissive: a broken count must not lock users out. */
async function withinQuota(userId: string): Promise<boolean> {
  try {
    const rows = (await getDb().query(
      "SELECT plan, subscription_status FROM users WHERE id = $1",
      [userId],
    )) as Array<{ plan: string; subscription_status: string | null }>;
    const u = rows[0];
    if (!u) return true;
    if (u.plan !== "lite" && subscriptionActive(u.subscription_status)) return true;
    const limit = Number(process.env.LITE_DAILY_MESSAGES ?? "20") || 20;
    const used = (await getDb().query(
      `SELECT COUNT(*)::int AS n FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.user_id = $1 AND m.role = 'assistant'
         AND m.created_at >= date_trunc('day', now())`,
      [userId],
    )) as Array<{ n: number }>;
    return (used[0]?.n ?? 0) < limit;
  } catch (err) {
    console.error(`quota check failed: ${err instanceof Error ? err.message : err}`);
    return true;
  }
}

export async function POST(req: Request) {
  let body: { question?: unknown; docIds?: unknown; conversationId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    return Response.json({ detail: "Question must be a non-empty string." }, { status: 400 });
  }
  const docIds = Array.isArray(body.docIds)
    ? body.docIds.filter((d): d is string => typeof d === "string" && d.length > 0).slice(0, 10)
    : [];
  // The session user scopes document retrieval server-side; the browser
  // never supplies a user id of its own.
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? null;
  if (session?.user) {
    const allowed = await withinQuota(session.user.id);
    if (!allowed) {
      return Response.json(
        { detail: "You have reached today's free answer limit. Upgrade for unlimited answers." },
        { status: 402 },
      );
    }
  }

  const base = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
  try {
    const upstream = await fetch(`${base}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // No language filter: the API matches every query automatically and
      // answers in the question's language.
      body: JSON.stringify({
        question: body.question,
        language: null,
        limit: 6,
        user_id: userId,
        doc_ids: docIds,
        conversation_id:
          typeof body.conversationId === "string" && body.conversationId.length > 0
            ? body.conversationId.slice(0, 64)
            : null,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok || !upstream.body) {
      console.error(`chat upstream HTTP ${upstream.status}`);
      return Response.json({ detail: GENERIC_ERROR }, { status: 502 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (err) {
    console.error(`chat upstream unreachable: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 502 });
  }
}
