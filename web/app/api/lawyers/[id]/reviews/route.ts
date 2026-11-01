import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** Leave (or update) a 1-5 rating for a verified lawyer. Signed-in users
 * only, never yourself, one review per lawyer. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const { id } = await params;
  if (!id || id === session.user.id) {
    return Response.json({ detail: "You cannot review yourself." }, { status: 400 });
  }
  let body: { rating?: unknown; comment?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  const rating = typeof body.rating === "number" ? Math.round(body.rating) : NaN;
  const comment =
    typeof body.comment === "string" && body.comment.trim()
      ? body.comment.trim().slice(0, 500)
      : null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return Response.json({ detail: "Rating must be 1 to 5." }, { status: 400 });
  }
  const db = getDb();
  const target = (await db.query(
    "SELECT id FROM users WHERE id = $1 AND role = 'lawyer' AND lawyer_status = 'verified'",
    [id],
  )) as Array<{ id: string }>;
  if (!target[0]) {
    return Response.json({ detail: "No verified lawyer found." }, { status: 404 });
  }
  await db.query(
    `INSERT INTO lawyer_reviews (lawyer_id, reviewer_id, rating, comment)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (lawyer_id, reviewer_id) DO UPDATE SET
       rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()`,
    [id, session.user.id, rating, comment],
  );
  return Response.json({ ok: true });
}
