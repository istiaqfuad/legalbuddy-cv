import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";

/** Headline counts for the admin dashboard. Admins only. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(await isAdminUser(session.user.id, session.user.email))) {
    return Response.json({ detail: "Sign in required." }, { status: 401 });
  }
  const q = (text: string) =>
    getDb().query(text) as Promise<Array<Record<string, string | number>>>;
  const [[users], plans, roles, lawyer, [convs], [msgs], [pending], [today]] = await Promise.all([
    q("SELECT COUNT(*)::int AS n FROM users"),
    q("SELECT plan, COUNT(*)::int AS n FROM users GROUP BY plan"),
    q("SELECT role, COUNT(*)::int AS n FROM users GROUP BY role"),
    q("SELECT lawyer_status, COUNT(*)::int AS n FROM users GROUP BY lawyer_status"),
    q("SELECT COUNT(*)::int AS n FROM conversations"),
    q("SELECT COUNT(*)::int AS n FROM messages"),
    q("SELECT COUNT(*)::int AS n FROM lawyer_verifications WHERE status = 'pending'"),
    q("SELECT COUNT(*)::int AS n FROM users WHERE created_at >= date_trunc('day', now())"),
  ]);
  const by = (rows: Array<Record<string, string | number>>) =>
    Object.fromEntries(rows.map((r) => [String(r.plan ?? r.role ?? r.lawyer_status), Number(r.n)]));
  return Response.json({
    users: Number(users.n),
    signupsToday: Number(today.n),
    pendingReviews: Number(pending.n),
    conversations: Number(convs.n),
    messages: Number(msgs.n),
    byPlan: by(plans),
    byRole: by(roles),
    byLawyerStatus: by(lawyer),
  });
}
