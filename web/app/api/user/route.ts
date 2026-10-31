import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** Update the signed-in user's profile: display name or onboarding fields
 * (account type, company, plan, lawyer intent). Onboarding flips the flag
 * so /post-login stops redirecting. */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  let body: {
    name?: unknown;
    accountType?: unknown;
    companyName?: unknown;
    role?: unknown;
    plan?: unknown;
    onboarded?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body?.name === "string" && body.name.trim()) {
    sets.push(`name = $${sets.length + 1}`);
    vals.push(body.name.trim().slice(0, 60));
  }
  if (body?.accountType === "individual" || body?.accountType === "business") {
    sets.push(`account_type = $${sets.length + 1}`);
    vals.push(body.accountType);
  }
  if (typeof body?.companyName === "string") {
    sets.push(`company_name = $${sets.length + 1}`);
    vals.push(body.companyName.trim().slice(0, 120) || null);
  }
  // Allowlist: 'admin' is never assignable here (reserved for the future
  // admin dashboard; granted manually in the database until then).
  if (body?.role === "lawyer" || body?.role === "user") {
    sets.push(`role = $${sets.length + 1}`);
    vals.push(body.role);
    if (body.role === "lawyer") {
      sets.push(`lawyer_status = $${sets.length + 1}`);
      vals.push("pending");
    }
  }
  if (body?.plan === "lite" || body?.plan === "professional" || body?.plan === "business") {
    sets.push(`plan = $${sets.length + 1}`);
    vals.push(body.plan);
  }
  if (body?.onboarded === true) {
    sets.push(`onboarded = $${sets.length + 1}`);
    vals.push(true);
  }
  if (sets.length === 0) {
    return Response.json({ detail: "Nothing to update." }, { status: 400 });
  }
  try {
    await getDb().query(
      `UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length + 1}`,
      [...vals, session.user.id],
    );
    return Response.json({ ok: true });
  } catch (err) {
    console.error(`profile update failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not save your details." }, { status: 500 });
  }
}
