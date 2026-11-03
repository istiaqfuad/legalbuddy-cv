import { verifiedLawyer } from "@/lib/business";
import { getDb } from "@/lib/db";

const GENERIC_ERROR = "Could not update the request. Please try again.";

/** Accept or close a handoff assigned to the signed-in lawyer. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const lawyer = await verifiedLawyer();
  if (!lawyer) return Response.json({ detail: "Verified lawyers only." }, { status: 403 });
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  const status = typeof body.status === "string" ? body.status : "";
  if (status !== "accepted" && status !== "closed") {
    return Response.json({ detail: "Status must be accepted or closed." }, { status: 400 });
  }
  const note = typeof body.lawyer_note === "string" ? body.lawyer_note.trim().slice(0, 1000) : "";
  try {
    const rows = (await getDb().query(
      "UPDATE business_handoffs SET status = $1, lawyer_note = $2, updated_at = now() WHERE id = $3 AND lawyer_id = $4 RETURNING id",
      [status, note, id, lawyer.id],
    )) as Array<unknown>;
    if (!rows.length) return Response.json({ detail: "Request not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`handoff update failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
}
