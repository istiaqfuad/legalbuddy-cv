import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** Billing + profile state for the UI: plan, subscription status,
 * account type, and lawyer verification state. Read-only. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const rows = (await getDb().query(
    `SELECT account_type, company_name, role, lawyer_status, onboarded,
            plan, subscription_status
     FROM users WHERE id = $1`,
    [session.user.id],
  )) as Array<{
    account_type: string;
    company_name: string | null;
    role: string;
    lawyer_status: string;
    onboarded: boolean;
    plan: string;
    subscription_status: string | null;
  }>;
  const u = rows[0];
  if (!u) return Response.json({ detail: "Sign in required." }, { status: 401 });
  return Response.json({
    accountType: u.account_type,
    companyName: u.company_name,
    role: u.role,
    lawyerStatus: u.lawyer_status,
    onboarded: u.onboarded,
    plan: u.plan,
    subscriptionStatus: u.subscription_status,
  });
}
