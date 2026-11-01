import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { LANGUAGES, PRACTICE_AREAS, profileText } from "@/lib/lawyers";

/** The signed-in lawyer's own editable profile. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const rows = (await getDb().query(
    `SELECT p.practice_areas, p.languages, p.city, p.bio, u.role, u.lawyer_status
     FROM users u LEFT JOIN lawyer_profiles p ON p.user_id = u.id WHERE u.id = $1`,
    [session.user.id],
  )) as Array<{
    practice_areas: string[] | null;
    languages: string[] | null;
    city: string | null;
    bio: string | null;
    role: string;
    lawyer_status: string;
  }>;
  const r = rows[0];
  if (!r || r.role !== "lawyer") {
    return Response.json({ detail: "Lawyer accounts only." }, { status: 403 });
  }
  return Response.json({
    practiceAreas: r.practice_areas ?? [],
    languages: r.languages ?? ["english"],
    city: r.city,
    bio: r.bio,
    lawyerStatus: r.lawyer_status,
  });
}

/** Upsert the lawyer's profile and refresh its cached embedding. */
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  let body: { practiceAreas?: unknown; languages?: unknown; city?: unknown; bio?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  const areas = Array.isArray(body.practiceAreas)
    ? body.practiceAreas.filter((a): a is string => typeof a === "string" && (PRACTICE_AREAS as readonly string[]).includes(a)).slice(0, 4)
    : null;
  const langs = Array.isArray(body.languages)
    ? body.languages.filter((l): l is string => typeof l === "string" && (LANGUAGES as readonly string[]).includes(l))
    : null;
  const city = typeof body.city === "string" ? body.city.trim().slice(0, 80) || null : undefined;
  const bio = typeof body.bio === "string" ? body.bio.trim().slice(0, 1000) || null : undefined;
  if (!areas && !langs && city === undefined && bio === undefined) {
    return Response.json({ detail: "Nothing to update." }, { status: 400 });
  }
  const db = getDb();
  const role = (await db.query("SELECT role FROM users WHERE id = $1", [session.user.id])) as Array<{
    role: string;
  }>;
  if (!role[0] || role[0].role !== "lawyer") {
    return Response.json({ detail: "Lawyer accounts only." }, { status: 403 });
  }
  const patch: Record<string, unknown> = {};
  if (areas) patch.practice_areas = areas;
  if (langs && langs.length > 0) patch.languages = langs;
  if (city !== undefined) patch.city = city;
  if (bio !== undefined) patch.bio = bio;
  const keys = Object.keys(patch);
  await db.query(
    `INSERT INTO lawyer_profiles (user_id, ${keys.join(", ")})
     VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")})
     ON CONFLICT (user_id) DO UPDATE SET
       ${keys.map((k) => `${k} = EXCLUDED.${k}`).join(", ")},
       updated_at = now()`,
    [session.user.id, ...keys.map((k) => patch[k])],
  );
  // Refresh the cached embedding from the merged row.
  const merged = (await db.query(
    "SELECT practice_areas, languages, city, bio FROM lawyer_profiles WHERE user_id = $1",
    [session.user.id],
  )) as Array<{
    practice_areas: string[] | null;
    languages: string[] | null;
    city: string | null;
    bio: string | null;
  }>;
  const m = merged[0];
  if (m) {
    try {
      const base = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
      const res = await fetch(`${base}/api/profile-embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: profileText(m) || "lawyer" }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        const out = (await res.json()) as { embedding?: number[] };
        if (Array.isArray(out.embedding)) {
          await db.query("UPDATE lawyer_profiles SET profile_embedding = $1 WHERE user_id = $2", [
            JSON.stringify(out.embedding),
            session.user.id,
          ]);
        }
      } else {
        console.error(`profile embed upstream: ${res.status}`);
      }
    } catch (err) {
      console.error(`profile embed failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  return Response.json({ ok: true });
}
