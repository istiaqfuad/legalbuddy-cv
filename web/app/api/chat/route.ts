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

export async function POST(req: Request) {
  let body: { question?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    return Response.json({ detail: "Question must be a non-empty string." }, { status: 400 });
  }

  const base = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
  try {
    const upstream = await fetch(`${base}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // No language filter: the API matches every query automatically and
      // answers in the question's language.
      body: JSON.stringify({ question: body.question, language: null, limit: 6 }),
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
