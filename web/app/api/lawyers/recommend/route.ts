import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/** Ranked lawyer suggestions for the signed-in user, derived from their
 * matter history. The Python matcher owns classification and scoring. */
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  try {
    const base = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
    const res = await fetch(`${base}/api/match-lawyers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: session.user.id, limit: 3 }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) throw new Error(`matcher upstream: ${res.status}`);
    return Response.json(await res.json());
  } catch (err) {
    console.error(`recommend failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not load suggestions. Please try again." }, { status: 502 });
  }
}
