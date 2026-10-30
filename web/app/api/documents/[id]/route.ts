import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** Delete a document: metadata row (links cascade) plus its vectors. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const { id } = await params;
  try {
    const owned = (await getDb().query(
      "SELECT 1 FROM documents WHERE id = $1 AND user_id = $2",
      [id, session.user.id],
    )) as Array<unknown>;
    if (owned.length === 0) {
      return Response.json({ detail: "Document not found." }, { status: 404 });
    }
    await getDb().query("DELETE FROM documents WHERE id = $1", [id]);
    const base = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
    try {
      await fetch(
        `${base}/api/documents/${encodeURIComponent(id)}?user_id=${encodeURIComponent(session.user.id)}`,
        { method: "DELETE", signal: AbortSignal.timeout(60_000) },
      );
    } catch (err) {
      // Metadata is gone; vectors without metadata are unreachable because
      // every query filters user_id + doc_id from this table's rows.
      console.error(`document vector cleanup failed: ${err instanceof Error ? err.message : err}`);
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`document delete failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not delete the document." }, { status: 500 });
  }
}
