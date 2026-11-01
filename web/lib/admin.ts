import { getDb } from "@/lib/db";

/** Admin access: the reserved 'admin' role (granted manually in the
 * database until the admin dashboard can assign it) or a bootstrap
 * email in ADMIN_EMAILS. Everything under /admin and /api/admin/* uses
 * this; never trust a client-sent role. */
export async function isAdminUser(
  userId: string | null | undefined,
  email: string | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  if (email) {
    const list = (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (list.includes(email.toLowerCase())) return true;
  }
  try {
    const rows = (await getDb().query("SELECT role FROM users WHERE id = $1", [
      userId,
    ])) as Array<{ role: string }>;
    return rows[0]?.role === "admin";
  } catch (err) {
    console.error(`admin check failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
