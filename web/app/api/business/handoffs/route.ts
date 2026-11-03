import { businessOwner, handoffEligibleLawyer } from "@/lib/business";
import { getDb } from "@/lib/db";

const GENERIC_ERROR = "Could not load requests. Please try again.";

/** The owner's handoff requests with lawyer names and statuses. */
export async function GET() {
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  try {
    const rows = (await getDb().query(
      `SELECT h.id, h.subject, h.details, h.doc_ids, h.status, h.lawyer_note,
              to_char(h.created_at, 'YYYY-MM-DD') AS created,
              COALESCE(u.name, '') AS lawyer_name
       FROM business_handoffs h
       JOIN users u ON u.id = h.lawyer_id
       WHERE h.user_id = $1 ORDER BY h.created_at DESC LIMIT 50`,
      [owner.id],
    )) as Array<Record<string, unknown>>;
    return Response.json({ handoffs: rows });
  } catch (err) {
    console.error(`handoff list failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
}

/** Package the facts and files for one verified lawyer. The request
 * carries the owner's words and vault filenames; the advice happens
 * off-platform between owner and advocate. */
export async function POST(req: Request) {
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  const lawyerId = typeof body.lawyer_id === "string" ? body.lawyer_id : "";
  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 160) : "";
  const details = typeof body.details === "string" ? body.details.trim().slice(0, 2000) : "";
  const docIds = Array.isArray(body.doc_ids)
    ? body.doc_ids.filter((d): d is string => typeof d === "string" && d.length > 0).slice(0, 10)
    : [];
  if (!lawyerId) return Response.json({ detail: "Choose a lawyer first." }, { status: 400 });
  if (!subject) return Response.json({ detail: "Give the request a subject." }, { status: 400 });
  if (!(await handoffEligibleLawyer(lawyerId))) {
    return Response.json({ detail: "That lawyer is not taking requests right now." }, { status: 400 });
  }
  try {
    if (docIds.length) {
      const own = (await getDb().query("SELECT id FROM documents WHERE user_id = $1 AND id = ANY($2)", [
        owner.id,
        docIds,
      ])) as Array<{ id: string }>;
      const mine = new Set(own.map((r) => r.id));
      const foreign = docIds.filter((d) => !mine.has(d));
      if (foreign.length) return Response.json({ detail: "One of those files is not yours." }, { status: 400 });
    }
    await getDb().query(
      `INSERT INTO business_handoffs (user_id, lawyer_id, subject, details, doc_ids)
       VALUES ($1, $2, $3, $4, $5)`,
      [owner.id, lawyerId, subject, details, docIds],
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`handoff create failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
}
