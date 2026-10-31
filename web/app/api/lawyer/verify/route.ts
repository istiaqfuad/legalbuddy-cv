import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { uploadSanad } from "@/lib/storage";

const GENERIC_ERROR = "Could not submit verification. Please try again.";

/** Normalize for matching: lowercase alphanumerics only. */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when the submitted name and Sanad number both appear in the scan:
 * every digit group of the number must occur, and at least half of the
 * significant name tokens must occur. */
export function matchesScan(
  fullName: string,
  sanadNo: string,
  ocrText: string,
): boolean {
  const ocr = squash(ocrText);
  if (!ocr) return false;
  const digits = sanadNo.replace(/[^0-9]/g, "");
  if (!digits || digits.length < 3 || !ocr.includes(digits)) return false;
  const tokens = fullName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((t) => ocr.includes(t)).length;
  return hits / tokens.length >= 0.5;
}

async function transcribe(data: Buffer, filename: string): Promise<string> {
  const base = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(data)], { type: "application/octet-stream" }), filename);
  const res = await fetch(`${base}/api/ocr`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`ocr upstream: ${res.status}`);
  const out = (await res.json()) as { text?: unknown };
  return typeof out.text === "string" ? out.text : "";
}

/** Submit (or resubmit) lawyer verification: Sanad scan to private object
 * storage, OCR cross-check, auto-verify on a name+number match. */
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
    let ocrText = "";
    try {
      ocrText = (await transcribe(bytes, file.name || "scan")).slice(0, 8000);
    } catch (err) {
      // OCR is enrichment: an unreadable scan goes to manual review.
      console.error(`sanad ocr failed: ${err instanceof Error ? err.message : err}`);
    }
    const match = matchesScan(fullName, sanadNo, ocrText);
    const status = match ? "verified" : "pending";
    const db = getDb();
    await db.query(
      `INSERT INTO lawyer_verifications (user_id, full_name, sanad_no, enrollment_date,
                                         bar_association, object_key, ocr_text, ocr_match, status)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id) DO UPDATE SET
         full_name = EXCLUDED.full_name, sanad_no = EXCLUDED.sanad_no,
         enrollment_date = EXCLUDED.enrollment_date, bar_association = EXCLUDED.bar_association,
         object_key = EXCLUDED.object_key, ocr_text = EXCLUDED.ocr_text,
         ocr_match = EXCLUDED.ocr_match, status = EXCLUDED.status,
         reviewer_note = NULL, updated_at = now()`,
      [session.user.id, fullName, sanadNo, enrollmentDate, barAssociation, key, ocrText || null, match, status],
    );
    await db.query(
      "UPDATE users SET role = 'lawyer', lawyer_status = $1, updated_at = now() WHERE id = $2",
      [status, session.user.id],
    );
    return Response.json({ ok: true, status, match });
  } catch (err) {
    console.error(`verification submit failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 502 });
  }
}

/** Current verification state for the signed-in user. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
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

function isAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return list.includes(email.toLowerCase());
}

/** Manual review: approve or reject a verification (admin emails only). */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdmin(session.user.email)) {
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
