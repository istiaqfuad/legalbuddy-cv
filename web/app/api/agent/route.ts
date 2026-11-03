import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { internalBase, internalHeaders } from "@/lib/internal-api";
import { subscriptionActive } from "@/lib/stripe";

/** Deep-research proxy: browser -> Next route -> Python agent stream.
///
/// Plan gate: Lite has no agent mode (the toggle stays locked with an
/// upgrade nudge). Starter runs a short leash, Professional/Business
/// the full loop. Answers count toward the same daily quota as simple
/// RAG, so no new tables: the quota gate below runs first.
*/

const UPSTREAM_TIMEOUT_MS = 300_000;
const GENERIC_ERROR = "The assistant is unavailable right now. Please try again in a moment.";

/** Tool-step budget per plan: Starter tastes the loop, paid tiers run it.
 * Only a current subscription unlocks it; a lapsed paid plan is Lite. */
function stepBudget(plan: string, status: string | null): number | null {
  if (!subscriptionActive(status)) return null;
  if (plan === "starter") return 4;
  if (plan === "professional" || plan === "business") return 8;
  return null;
}

async function planAndStatus(userId: string): Promise<{ plan: string; status: string | null }> {
  const rows = (await getDb().query("SELECT plan, subscription_status FROM users WHERE id = $1", [
    userId,
  ])) as Array<{ plan: string; subscription_status: string | null }>;
  return { plan: rows[0]?.plan ?? "lite", status: rows[0]?.subscription_status ?? null };
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
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const docIds = Array.isArray(body.docIds)
    ? body.docIds.filter((d): d is string => typeof d === "string" && d.length > 0).slice(0, 10)
    : [];
  let budget: number | null = null;
  try {
    const { plan, status } = await planAndStatus(session.user.id);
    budget = stepBudget(plan, status);
  } catch (err) {
    console.error(`agent plan check failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 502 });
  }
  if (budget === null) {
    return Response.json(
      { detail: "Deep research needs Starter or above. Upgrade to unlock it.", code: "agent-locked" },
      { status: 403 },
    );
  }

  const base = internalBase();
  try {
    const upstream = await fetch(`${base}/api/chat/agent/stream`, {
      method: "POST",
      headers: internalHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        question: body.question,
        language: null,
        limit: 6,
        user_id: session.user.id,
        doc_ids: docIds,
        conversation_id:
          typeof body.conversationId === "string" && body.conversationId.length > 0
            ? body.conversationId.slice(0, 64)
            : null,
        max_tool_calls: budget,
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!upstream.ok || !upstream.body) {
      console.error(`agent upstream HTTP ${upstream.status}`);
      return Response.json({ detail: GENERIC_ERROR }, { status: 502 });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (err) {
    console.error(`agent upstream unreachable: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 502 });
  }
}
