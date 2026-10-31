import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Post-auth router: fresh accounts finish onboarding, unverified
 * lawyers verify, everyone else lands in chat. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const rows = (await getDb().query(
    "SELECT onboarded, role, lawyer_status FROM users WHERE id = $1",
    [session.user.id],
  )) as Array<{ onboarded: boolean; role: string; lawyer_status: string }>;
  const u = rows[0];
  if (!u || !u.onboarded) redirect("/onboarding");
  if (u.role === "lawyer" && u.lawyer_status !== "verified") redirect("/verify-lawyer");
  redirect("/chat");
}
