import { businessOwner } from "@/lib/business";
import { getDb } from "@/lib/db";

/** Withdraw an open request. Accepted or closed ones stay as history. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  const { id } = await params;
  try {
    const rows = (await getDb().query(
      "DELETE FROM business_handoffs WHERE id = $1 AND user_id = $2 AND status = 'open' RETURNING id",
      [id, owner.id],
    )) as Array<unknown>;
    if (!rows.length) {
      return Response.json({ detail: "Only open requests can be withdrawn." }, { status: 409 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`handoff withdraw failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not withdraw the request. Please try again." }, { status: 500 });
  }
}
