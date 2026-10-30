import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** List the signed-in user's uploaded documents (metadata of record). */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  try {
    const rows = (await getDb().query(
      `SELECT id AS doc_id, filename, mime, chunk_count AS chunks, created_at
       FROM documents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [session.user.id],
    )) as Array<Record<string, unknown>>;
    return Response.json({ documents: rows });
  } catch (err) {
    console.error(`documents list failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not load documents." }, { status: 500 });
  }
}

/** Upload one file: parse/chunk/embed in Python, record metadata in Neon. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  let file: File | null = null;
  try {
    const form = await req.formData();
    const entry = form.get("file");
    if (entry instanceof File) file = entry;
  } catch {
    return Response.json({ detail: "Request must be a file upload." }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return Response.json({ detail: "Choose a file to upload." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ detail: "Files must be under 10 MB." }, { status: 400 });
  }
  const base = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
  try {
    const forward = new FormData();
    forward.append("file", file, file.name);
    const upstream = await fetch(
      `${base}/api/documents?user_id=${encodeURIComponent(session.user.id)}`,
      { method: "POST", body: forward, signal: AbortSignal.timeout(180_000) },
    );
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || !data?.doc_id) {
      const detail =
        typeof data?.detail === "string" && data.detail
          ? data.detail
          : "Could not process the file. Please try again.";
      return Response.json({ detail }, { status: upstream.status === 400 ? 400 : 502 });
    }
    await getDb().query(
      `INSERT INTO documents (id, user_id, filename, mime, size_bytes, chunk_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [data.doc_id, session.user.id, data.filename, data.mime, file.size, data.chunks],
    );
    return Response.json({
      document: {
        doc_id: data.doc_id,
        filename: data.filename,
        mime: data.mime,
        chunks: data.chunks,
        created_at: data.created_at,
      },
    });
  } catch (err) {
    console.error(`document upload failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not process the file. Please try again." }, { status: 502 });
  }
}
