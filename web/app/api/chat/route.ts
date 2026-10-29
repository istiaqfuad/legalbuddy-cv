/** Server-side proxy: browser -> Next route -> Python API.
 *
 * The Python API (Voyage + Qdrant + Baseten keys) is never exposed to the
 * browser. `API_INTERNAL_URL` points at it inside compose
 * (`http://api:8000`) and defaults to localhost for `npm run dev`.
 * Reasoning models are slow: allow up to 3 minutes upstream.
 */

const UPSTREAM_TIMEOUT_MS = 180_000;

export async function POST(req: Request) {
  let body: { question?: unknown; language?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "request body must be JSON" }, { status: 400 });
  }
  if (typeof body.question !== "string" || body.question.trim().length === 0) {
    return Response.json({ detail: "question must be a non-empty string" }, { status: 400 });
  }
  const language =
    body.language === "english" || body.language === "bengali" ? body.language : null;

  const base = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
  try {
    const upstream = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: body.question, language, limit: 6 }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const data = await upstream.json();
    return Response.json(data, { status: upstream.status });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return Response.json(
      { detail: `answer service unreachable: ${reason}` },
      { status: 502 },
    );
  }
}
