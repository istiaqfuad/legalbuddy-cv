import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

async function owns(conversationId: string, userId: string): Promise<boolean> {
  const rows = (await getDb().query(
    "SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2",
    [conversationId, userId],
  )) as Array<unknown>;
  return rows.length > 0;
}

/** Read one conversation's messages, oldest first. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const { id } = await params;
  try {
    if (!(await owns(id, session.user.id))) {
      return Response.json({ detail: "Conversation not found." }, { status: 404 });
    }
    const rows = (await getDb().query(
      "SELECT role, content, citations, model, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
      [id],
    )) as Array<{
      role: "user" | "assistant";
      content: string;
      citations: unknown;
      model: string | null;
      created_at: string;
    }>;
    return Response.json({ messages: rows });
  } catch (err) {
    console.error(`conversation read failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not load the conversation." }, { status: 500 });
  }
}

/** Rename a conversation. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const { id } = await params;
  let title: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.title === "string" && body.title.trim()) {
      title = body.title.trim().slice(0, 80);
    }
  } catch {
    // Falls through to the 400 below.
  }
  if (!title) return Response.json({ detail: "Title is required." }, { status: 400 });
  try {
    if (!(await owns(id, session.user.id))) {
      return Response.json({ detail: "Conversation not found." }, { status: 404 });
    }
    await getDb().query("UPDATE conversations SET title = $1, updated_at = now() WHERE id = $2", [
      title,
      id,
    ]);
    return Response.json({ ok: true, title });
  } catch (err) {
    console.error(`conversation rename failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not rename the conversation." }, { status: 500 });
  }
}

/** Delete a conversation and its messages. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const { id } = await params;
  try {
    if (!(await owns(id, session.user.id))) {
      return Response.json({ detail: "Conversation not found." }, { status: 404 });
    }
    await getDb().query("DELETE FROM conversations WHERE id = $1", [id]);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`conversation delete failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not delete the conversation." }, { status: 500 });
  }
}
