import { hash } from "bcryptjs";
import { getDb } from "@/lib/db";

const GENERIC_ERROR = "Could not create the account. Please try again.";

/** Email signup. Creates the user row, then the client signs in. */
export async function POST(req: Request) {
  let body: { email?: unknown; name?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ detail: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ detail: "Password must be at least 8 characters." }, { status: 400 });
  }
  try {
    await getDb().query(
      "INSERT INTO users (email, name, password_hash, provider) VALUES ($1, $2, $3, 'credentials')",
      [email, name, await hash(password, 10)],
    );
    return Response.json({ ok: true });
  } catch (err) {
    // Unique violation -> that email is taken. Anything else stays generic.
    if (err instanceof Error && "code" in err && (err as { code: string }).code === "23505") {
      return Response.json({ detail: "An account with this email already exists. Sign in instead." }, { status: 409 });
    }
    console.error(`signup failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
}
