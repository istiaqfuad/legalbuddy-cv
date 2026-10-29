import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** List the signed-in user's conversations, newest first. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  try {
    const rows = (await getDb().query(
      "SELECT id, title, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50",
      [session.user.id],
    )) as Array<{ id: string; title: string; updated_at: string }>;
    return Response.json({ conversations: rows });
  } catch (err) {
    console.error(`conversations list failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not load conversations." }, { status: 500 });
  }
}

/** Start a conversation. Title defaults to the first question, set later. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  let title = "New chat";
  try {
    const body = await req.json();
    if (typeof body?.title === "string" && body.title.trim()) {
      title = body.title.trim().slice(0, 80);
    }
  } catch {
    // Empty body is fine; keep the default title.
  }
  try {
    const rows = (await getDb().query(
      "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id, title, updated_at",
      [session.user.id, title],
    )) as Array<{ id: string; title: string; updated_at: string }>;
    return Response.json({ conversation: rows[0] });
  } catch (err) {
    console.error(`conversation create failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not start a conversation." }, { status: 500 });
  }
}
