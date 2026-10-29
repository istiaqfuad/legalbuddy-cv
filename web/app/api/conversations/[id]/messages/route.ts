import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** Append one message to a conversation the user owns. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const { id } = await params;
  let body: { role?: unknown; content?: unknown; citations?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  if (body.role !== "user" && body.role !== "assistant") {
    return Response.json({ detail: "Role must be user or assistant." }, { status: 400 });
  }
  if (typeof body.content !== "string" || !body.content) {
    return Response.json({ detail: "Content is required." }, { status: 400 });
  }
  const citations = Array.isArray(body.citations) ? body.citations : [];
  const model = typeof body.model === "string" && body.model ? body.model : null;
  try {
    const owners = (await getDb().query(
      "SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2",
      [id, session.user.id],
    )) as Array<unknown>;
    if (owners.length === 0) {
      return Response.json({ detail: "Conversation not found." }, { status: 404 });
    }
    await getDb().query(
      "INSERT INTO messages (conversation_id, role, content, citations, model) VALUES ($1, $2, $3, $4, $5)",
      [id, body.role, body.content, JSON.stringify(citations), model],
    );
    await getDb().query("UPDATE conversations SET updated_at = now() WHERE id = $1", [id]);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`message save failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not save the message." }, { status: 500 });
  }
}
