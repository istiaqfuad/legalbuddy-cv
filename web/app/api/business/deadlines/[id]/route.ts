import { businessOwner, rollForward } from "@/lib/business";
import { getDb } from "@/lib/db";

const GENERIC_ERROR = "Could not update the deadline. Please try again.";

function validDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
}

/** Edit a deadline, or mark it done. Completing a recurring deadline
 * rolls it forward to its next occurrence instead of closing it. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  try {
    const rows = (await getDb().query(
      "SELECT recurrence, to_char(due_date, 'YYYY-MM-DD') AS due_date FROM business_deadlines WHERE id = $1 AND user_id = $2",
      [id, owner.id],
    )) as Array<{ recurrence: string; due_date: string }>;
    const current = rows[0];
    if (!current) return Response.json({ detail: "Deadline not found." }, { status: 404 });
    if (body.done === true && current.recurrence !== "none") {
      const next = rollForward(current.due_date, current.recurrence);
      await getDb().query(
        "UPDATE business_deadlines SET due_date = $1, done = FALSE, updated_at = now() WHERE id = $2",
        [next ?? current.due_date, id],
      );
      return Response.json({ ok: true, rolled_to: next ?? current.due_date });
    }
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (typeof body.title === "string" && body.title.trim()) {
      sets.push(`title = $${sets.length + 1}`);
      vals.push(body.title.trim().slice(0, 160));
    }
    if (validDate(body.due_date)) {
      sets.push(`due_date = $${sets.length + 1}`);
      vals.push(body.due_date);
    }
    if (body.done === true || body.done === false) {
      sets.push(`done = $${sets.length + 1}`);
      vals.push(body.done);
    }
    if (!sets.length) return Response.json({ detail: "Nothing to update." }, { status: 400 });
    vals.push(id, owner.id);
    await getDb().query(
      `UPDATE business_deadlines SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${sets.length + 1} AND user_id = $${sets.length + 2}`,
      vals,
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`business deadline update failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
}

/** Stop tracking a deadline. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  const { id } = await params;
  try {
    await getDb().query("DELETE FROM business_deadlines WHERE id = $1 AND user_id = $2", [id, owner.id]);
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`business deadline delete failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
}
