import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";

/** Update the signed-in user's display name. */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  let name: string | null = null;
  try {
    const body = await req.json();
    if (typeof body?.name === "string" && body.name.trim()) {
      name = body.name.trim().slice(0, 60);
    }
  } catch {
    // Falls through to the 400 below.
  }
  if (!name) return Response.json({ detail: "Name is required." }, { status: 400 });
  try {
    await getDb().query("UPDATE users SET name = $1, updated_at = now() WHERE id = $2", [
      name,
      session.user.id,
    ]);
    return Response.json({ ok: true, name });
  } catch (err) {
    console.error(`profile update failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: "Could not save your name." }, { status: 500 });
  }
}
