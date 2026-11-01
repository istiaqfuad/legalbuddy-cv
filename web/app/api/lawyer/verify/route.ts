import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { uploadSanad } from "@/lib/storage";

const GENERIC_ERROR = "Could not submit verification. Please try again.";

/** Submit (or resubmit) lawyer verification: the Sanad scan goes to
 * private object storage and the request waits for human review.
 * Automated reading was tried and dropped: the vision model refuses to
 * transcribe ID documents, so every Sanad needs human eyes. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ detail: "Request must be multipart form data." }, { status: 400 });
  }
  const fullName = String(form.get("fullName") ?? "").trim().slice(0, 120);
  const sanadNo = String(form.get("sanadNo") ?? "").trim().slice(0, 40);
  const barAssociation = String(form.get("barAssociation") ?? "").trim().slice(0, 120);
  const enrollmentDateRaw = String(form.get("enrollmentDate") ?? "").trim();
  const file = form.get("sanad");
  if (!fullName || !sanadNo || !barAssociation) {
    return Response.json({ detail: "Name, Sanad number, and bar association are required." }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) {
    return Response.json({ detail: "Attach a readable Sanad scan (up to 10 MB)." }, { status: 400 });
  }
  const kind = file.type.startsWith("image/") || file.type === "application/pdf";
  if (!kind) {
    return Response.json({ detail: "The scan must be an image or PDF." }, { status: 400 });
  }
  const enrollmentDate = /^\d{4}-\d{2}-\d{2}$/.test(enrollmentDateRaw) ? enrollmentDateRaw : null;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const key = await uploadSanad(session.user.id, file.name || "sanad", bytes, file.type);
    const db = getDb();
    await db.query(
      `INSERT INTO lawyer_verifications (user_id, full_name, sanad_no, enrollment_date,
                                         bar_association, object_key, status)
       VALUES ($1, $2, $3, $4::date, $5, $6, 'pending')
       ON CONFLICT (user_id) DO UPDATE SET
         full_name = EXCLUDED.full_name, sanad_no = EXCLUDED.sanad_no,
         enrollment_date = EXCLUDED.enrollment_date, bar_association = EXCLUDED.bar_association,
         object_key = EXCLUDED.object_key, status = 'pending',
         reviewer_note = NULL, updated_at = now()`,
      [session.user.id, fullName, sanadNo, enrollmentDate, barAssociation, key],
    );
    await db.query(
      "UPDATE users SET role = 'lawyer', lawyer_status = 'pending', updated_at = now() WHERE id = $1",
      [session.user.id],
    );
    return Response.json({ ok: true, status: "pending" });
  } catch (err) {
    console.error(`verification submit failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 502 });
  }
}

/** Own verification state; admins can pull any user's file for review. */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const target = new URL(req.url).searchParams.get("userId");
  if (target) {
    if (!(await isAdminUser(session.user.id, session.user.email))) {
      return Response.json({ detail: "Sign in required." }, { status: 401 });
    }
    const rows = (await getDb().query(
      `SELECT user_id, full_name, sanad_no, enrollment_date, bar_association,
              object_key, status, reviewer_note, updated_at
       FROM lawyer_verifications WHERE user_id = $1`,
      [target],
    )) as Array<{
      user_id: string; full_name: string; sanad_no: string; enrollment_date: string | null;
      bar_association: string; object_key: string; status: string;
      reviewer_note: string | null; updated_at: string;
    }>;
    const v = rows[0];
    if (!v) return Response.json({ detail: "No verification found." }, { status: 404 });
    const { sanadUrl } = await import("@/lib/storage");
    return Response.json({ ...v, sanadUrl: await sanadUrl(v.object_key) });
  }
  const rows = (await getDb().query(
    `SELECT v.status, v.reviewer_note, v.updated_at, u.lawyer_status, u.role
     FROM users u LEFT JOIN lawyer_verifications v ON v.user_id = u.id
     WHERE u.id = $1`,
    [session.user.id],
  )) as Array<{ status: string | null; reviewer_note: string | null; updated_at: string; lawyer_status: string; role: string }>;
  const r = rows[0];
  return Response.json({
    role: r?.role ?? "user",
    lawyerStatus: r?.lawyer_status ?? "none",
    review: r?.status ? { status: r.status, note: r.reviewer_note, updatedAt: r.updated_at } : null,
  });
}

/** Manual review: approve or reject a verification (admins only). */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(await isAdminUser(session.user.id, session.user.email))) {
    return Response.json({ detail: "Sign in required." }, { status: 401 });
  }
  let body: { userId?: unknown; decision?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  const userId = typeof body.userId === "string" ? body.userId : "";
  const decision = body.decision === "verified" || body.decision === "rejected" ? body.decision : null;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : null;
  if (!userId || !decision) {
    return Response.json({ detail: "userId and a verified/rejected decision are required." }, { status: 400 });
  }
  const db = getDb();
  const updated = (await db.query(
    `UPDATE lawyer_verifications SET status = $1, reviewer_note = $2, updated_at = now()
     WHERE user_id = $3 RETURNING user_id`,
    [decision, note, userId],
  )) as Array<{ user_id: string }>;
  if (!updated[0]) return Response.json({ detail: "No verification found." }, { status: 404 });
  await db.query("UPDATE users SET lawyer_status = $1, updated_at = now() WHERE id = $2", [
    decision,
    userId,
  ]);
  return Response.json({ ok: true, status: decision });
}
