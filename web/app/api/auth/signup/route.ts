import { hash } from "bcryptjs";
import { getDb } from "@/lib/db";

const GENERIC_ERROR = "Could not create the account. Please try again.";

/** Email signup. Accepts the progressive-form fields: account type
 * (individual/business), optional company name, lawyer intent, and the
 * starting plan (lite is free; paid plans redirect to Checkout after). */
export async function POST(req: Request) {
  let body: { email?: unknown; name?: unknown; password?: unknown; accountType?: unknown; companyName?: unknown; role?: unknown; plan?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : null;
  const password = typeof body.password === "string" ? body.password : "";
  const accountType = body.accountType === "business" ? "business" : "individual";
  const companyName =
    accountType === "business" && typeof body.companyName === "string" && body.companyName.trim()
      ? body.companyName.trim().slice(0, 120)
      : null;
  // Allowlist: 'admin' is never assignable here (reserved for the future
  // admin dashboard; granted manually in the database until then).
  const role = body.role === "lawyer" ? "lawyer" : "user";
  const plan = body.plan === "professional" || body.plan === "business" ? body.plan : "lite";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ detail: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ detail: "Password must be at least 8 characters." }, { status: 400 });
  }
  try {
    await getDb().query(
      `INSERT INTO users (email, name, password_hash, provider, account_type,
                          company_name, role, lawyer_status, onboarded, plan)
       VALUES ($1, $2, $3, 'credentials', $4, $5, $6, $7, TRUE, $8)`,
      [
        email,
        name,
        await hash(password, 10),
        accountType,
        companyName,
        role,
        role === "lawyer" ? "pending" : "none",
        plan,
      ],
    );
    return Response.json({ ok: true, plan, role });
  } catch (err) {
    // Unique violation -> that email is taken. Anything else stays generic.
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
      return Response.json({ detail: "An account with this email already exists. Sign in instead." }, { status: 409 });
    }
    console.error(`signup failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
}
