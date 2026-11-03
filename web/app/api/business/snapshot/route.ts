import { businessOwner, deadlineState } from "@/lib/business";
import { getDb } from "@/lib/db";

/** Monthly snapshot: the owner's own records, summarized. No law, no
 * advice — counts of what was done, what is due, and which coverage
 * gaps (profile, vault, untracked files) need attention. */
export async function GET() {
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  try {
    const dl = (await getDb().query(
      `SELECT id, title, to_char(due_date, 'YYYY-MM-DD') AS due_date, done,
              proof_doc_id, category
       FROM business_deadlines WHERE user_id = $1 ORDER BY due_date`,
      [owner.id],
    )) as Array<{
      id: string;
      title: string;
      due_date: string;
      done: boolean;
      proof_doc_id: string | null;
      category: string;
    }>;
    const docs = (await getDb().query(
      "SELECT id AS doc_id, filename FROM documents WHERE user_id = $1 ORDER BY created_at DESC",
      [owner.id],
    )) as Array<{ doc_id: string; filename: string }>;
    const prof = (await getDb().query("SELECT user_id FROM business_profiles WHERE user_id = $1", [
      owner.id,
    ])) as Array<unknown>;

    const withState = dl.map((d) => ({ ...d, ...deadlineState(d.due_date, d.done) }));
    const open = withState.filter((d) => !d.done);
    const trackedDocIds = new Set(dl.map((d) => d.proof_doc_id).filter(Boolean));

    const thirtyAgo = new Date();
    thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    const doneLast30 = withState.filter((d) => d.done).length;

    const gaps: Array<{ kind: string; label: string }> = [];
    if (!prof.length) {
      gaps.push({ kind: "profile", label: "Add your business profile to unlock starter renewals." });
    }
    if (!docs.length) {
      gaps.push({ kind: "vault", label: "Upload your first licence or contract to the vault." });
    }
    for (const doc of docs) {
      if (!trackedDocIds.has(doc.doc_id)) {
        gaps.push({ kind: "doc", label: `${doc.filename} has no tracked expiry yet.` });
      }
    }

    return Response.json({
      snapshot: {
        overdue: open.filter((d) => d.state === "overdue").length,
        dueSoon: open.filter((d) => d.state === "due-soon").length,
        open: open.length,
        doneLast30,
        vaultFiles: docs.length,
        gaps: gaps.slice(0, 8),
        upcoming: open.slice(0, 5).map((d) => ({
          id: d.id,
          title: d.title,
          due_date: d.due_date,
          state: d.state,
          daysUntil: d.daysUntil,
        })),
      },
    });
  } catch (err) {
    console.error(`business snapshot failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not load the snapshot. Please try again." }, { status: 500 });
  }
}
