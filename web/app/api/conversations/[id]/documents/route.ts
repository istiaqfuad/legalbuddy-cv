import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** Documents attached to one conversation (ownership checked both ways). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const { id } = await params;
  try {
    const rows = (await getDb().query(
      `SELECT d.id AS doc_id, d.filename, d.mime, d.chunk_count AS chunks, d.created_at
       FROM conversation_documents cd
       JOIN documents d ON d.id = cd.document_id
       JOIN conversations c ON c.id = cd.conversation_id
       WHERE cd.conversation_id = $1 AND c.user_id = $2 AND d.user_id = $2
       ORDER BY cd.created_at ASC`,
      [id, session.user.id],
    )) as Array<Record<string, unknown>>;
    return Response.json({ documents: rows });
  } catch (err) {
    console.error(`conversation documents failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not load attached documents." }, { status: 500 });
  }
}

/** Attach one of the user's documents to the conversation. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const { id } = await params;
  let documentId: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.document_id === "string" && body.document_id) {
      documentId = body.document_id;
    }
  } catch {
    // Falls through to the 400 below.
  }
  if (!documentId) return Response.json({ detail: "document_id is required." }, { status: 400 });
  try {
    const ok = (await getDb().query(
      `SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2`,
      [id, session.user.id],
    )) as Array<unknown>;
    const owned = (await getDb().query(
      `SELECT 1 FROM documents WHERE id = $1 AND user_id = $2`,
      [documentId, session.user.id],
    )) as Array<unknown>;
    if (ok.length === 0 || owned.length === 0) {
      return Response.json({ detail: "Conversation or document not found." }, { status: 404 });
    }
    await getDb().query(
      `INSERT INTO conversation_documents (conversation_id, document_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, documentId],
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`document attach failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not attach the document." }, { status: 500 });
  }
}

/** Detach a document from the conversation (vectors stay for other chats). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const { id } = await params;
  const documentId = new URL(req.url).searchParams.get("document_id");
  if (!documentId) return Response.json({ detail: "document_id is required." }, { status: 400 });
  try {
    await getDb().query(
      `DELETE FROM conversation_documents cd USING conversations c
       WHERE cd.conversation_id = c.id AND c.id = $1 AND c.user_id = $2
       AND cd.document_id = $3`,
      [id, session.user.id, documentId],
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`document detach failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not detach the document." }, { status: 500 });
  }
}
