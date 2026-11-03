import { verifiedLawyer } from "@/lib/business";
import { getDb } from "@/lib/db";

/** Incoming handoff requests for the signed-in verified lawyer. */
export async function GET() {
  const lawyer = await verifiedLawyer();
  if (!lawyer) return Response.json({ detail: "Verified lawyers only." }, { status: 403 });
  try {
    const rows = (await getDb().query(
      `SELECT h.id, h.subject, h.details, h.doc_ids, h.status, h.lawyer_note,
              to_char(h.created_at, 'YYYY-MM-DD') AS created,
              COALESCE(u.name, '') AS owner_name,
              COALESCE(bp.business_name, '') AS business_name
       FROM business_handoffs h
       JOIN users u ON u.id = h.user_id
       LEFT JOIN business_profiles bp ON bp.user_id = h.user_id
       WHERE h.lawyer_id = $1 ORDER BY h.created_at DESC LIMIT 50`,
      [lawyer.id],
    )) as Array<Record<string, unknown>>;
    return Response.json({ handoffs: rows });
  } catch (err) {
    console.error(`lawyer handoff list failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not load requests. Please try again." }, { status: 500 });
  }
}
