import { businessOwner, deadlineState, rollForward } from "@/lib/business";
import { getDb } from "@/lib/db";

const GENERIC_ERROR = "Could not load deadlines. Please try again.";
const CATEGORIES = ["licence", "tax", "vat", "labour", "data", "other"];
const RECURRENCE = ["none", "monthly", "quarterly", "yearly"];

function validDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00`).getTime());
}

/** All deadlines with calendar states computed server-side. */
export async function GET() {
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  try {
    const rows = (await getDb().query(
      `SELECT id, title, category, to_char(due_date, 'YYYY-MM-DD') AS due_date,
              recurrence, source_section, source_url, done, proof_doc_id
       FROM business_deadlines WHERE user_id = $1 ORDER BY done, due_date`,
      [owner.id],
    )) as Array<Record<string, unknown>>;
    const deadlines = rows.map((r) => ({
      ...r,
      ...deadlineState(String(r.due_date), r.done === true),
    }));
    return Response.json({ deadlines });
  } catch (err) {
    console.error(`business deadlines read failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
}

/** Track a new obligation. Dates and citations are owner-supplied. */
export async function POST(req: Request) {
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";
  if (!title) return Response.json({ detail: "Give the deadline a title." }, { status: 400 });
  if (!validDate(body.due_date)) {
    return Response.json({ detail: "Give a valid due date (YYYY-MM-DD)." }, { status: 400 });
  }
  const category = typeof body.category === "string" ? body.category : "other";
  if (!CATEGORIES.includes(category)) return Response.json({ detail: "Unknown category." }, { status: 400 });
  const recurrence = typeof body.recurrence === "string" ? body.recurrence : "none";
  if (!RECURRENCE.includes(recurrence)) {
    return Response.json({ detail: "Unknown recurrence." }, { status: 400 });
  }
  const sourceSection = typeof body.source_section === "string" ? body.source_section.slice(0, 500) : "";
  const sourceUrl =
    typeof body.source_url === "string" && /^https?:\/\//.test(body.source_url)
      ? body.source_url.slice(0, 500)
      : "";
  const proofDocId = typeof body.proof_doc_id === "string" && body.proof_doc_id ? body.proof_doc_id.slice(0, 64) : null;
  try {
    await getDb().query(
      `INSERT INTO business_deadlines
         (user_id, title, category, due_date, recurrence, source_section, source_url, proof_doc_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [owner.id, title, category, body.due_date, recurrence, sourceSection, sourceUrl, proofDocId],
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`business deadline create failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
}
