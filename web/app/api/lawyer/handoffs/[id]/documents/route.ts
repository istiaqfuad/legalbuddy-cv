import { verifiedLawyer } from "@/lib/business";
import { getDb } from "@/lib/db";
import { internalBase, internalHeaders } from "@/lib/internal-api";

const GENERIC_ERROR = "Could not read the shared files. Please try again.";

/** Chunk texts of the vault files linked to one assigned handoff.
 * The lawyer sees only files the owner attached to their request;
 * every read is scoped to the owner's user id plus those doc ids. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const lawyer = await verifiedLawyer();
  if (!lawyer) return Response.json({ detail: "Verified lawyers only." }, { status: 403 });
  const { id } = await params;
  try {
    const rows = (await getDb().query(
      "SELECT user_id, doc_ids FROM business_handoffs WHERE id = $1 AND lawyer_id = $2",
      [id, lawyer.id],
    )) as Array<{ user_id: string; doc_ids: string[] }>;
    const handoff = rows[0];
    if (!handoff) return Response.json({ detail: "Request not found." }, { status: 404 });
    if (!handoff.doc_ids?.length) return Response.json({ files: [] });
    const base = internalBase();
    const files: Array<{ doc_id: string; filename: string; chunks: string[] }> = [];
    for (const docId of handoff.doc_ids.slice(0, 5)) {
      const meta = (await getDb().query("SELECT filename FROM documents WHERE id = $1 AND user_id = $2", [
        docId,
        handoff.user_id,
      ])) as Array<{ filename: string }>;
      if (!meta[0]) continue;
      try {
        const upstream = await fetch(
          `${base}/api/documents/text?${new URLSearchParams({ doc_id: docId, user_id: handoff.user_id })}`,
          { headers: internalHeaders(), signal: AbortSignal.timeout(60_000) },
        );
        const data = await upstream.json().catch(() => null);
        if (!upstream.ok || !Array.isArray(data?.chunks)) continue;
        files.push({ doc_id: docId, filename: meta[0].filename, chunks: data.chunks });
      } catch {
        continue;
      }
    }
    return Response.json({ files });
  } catch (err) {
    console.error(`handoff files failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 502 });
  }
}
