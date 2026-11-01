import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { sanadUrl } from "@/lib/storage";

/** Verification queue for the admin dashboard. `?status=` filters;
 * each row carries a short-lived scan link for review. Admins only. */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(await isAdminUser(session.user.id, session.user.email))) {
    return Response.json({ detail: "Sign in required." }, { status: 401 });
  }
  const status = new URL(req.url).searchParams.get("status");
  const where = status === "pending" || status === "verified" || status === "rejected"
    ? "WHERE v.status = $1"
    : "";
  const args = where ? [status] : [];
  const rows = (await getDb().query(
    `SELECT v.user_id, v.full_name, v.sanad_no, v.enrollment_date, v.bar_association,
            v.object_key, v.status, v.reviewer_note, v.updated_at, u.email
     FROM lawyer_verifications v JOIN users u ON u.id = v.user_id
     ${where} ORDER BY v.updated_at DESC LIMIT 100`,
    args,
  )) as Array<{
    user_id: string;
    full_name: string;
    sanad_no: string;
    enrollment_date: string | null;
    bar_association: string;
    object_key: string;
    status: string;
    reviewer_note: string | null;
    updated_at: string;
    email: string;
  }>;
  const items = await Promise.all(
    rows.map(async (v) => ({ ...v, object_key: undefined, sanadUrl: await sanadUrl(v.object_key) })),
  );
  return Response.json({ items });
}
