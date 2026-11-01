import { getDb } from "@/lib/db";

/** Public directory: verified lawyers with profiles, newest reviews
 * first by rating activity. No sign-in needed to browse. */
export async function GET() {
  const rows = (await getDb().query(
    `SELECT u.id, u.name, p.practice_areas, p.languages, p.city, p.bio,
            v.bar_association,
            COALESCE(AVG(r.rating), 0)::float AS rating_avg,
            COUNT(r.id)::int AS rating_count
     FROM users u
     JOIN lawyer_profiles p ON p.user_id = u.id
     LEFT JOIN lawyer_verifications v ON v.user_id = u.id
     LEFT JOIN lawyer_reviews r ON r.lawyer_id = u.id
     WHERE u.role = 'lawyer' AND u.lawyer_status = 'verified'
     GROUP BY u.id, u.name, p.practice_areas, p.languages, p.city, p.bio,
              v.bar_association
     ORDER BY rating_count DESC, u.created_at DESC
     LIMIT 100`,
  )) as Array<{
    id: string;
    name: string | null;
    practice_areas: string[] | null;
    languages: string[] | null;
    city: string | null;
    bio: string | null;
    bar_association: string | null;
    rating_avg: number;
    rating_count: number;
  }>;
  return Response.json({
    items: rows.map((r) => ({
      userId: r.id,
      displayName: r.name,
      practiceAreas: r.practice_areas ?? [],
      languages: r.languages ?? [],
      city: r.city,
      bio: r.bio,
      barAssociation: r.bar_association,
      ratingAvg: Math.round(Number(r.rating_avg) * 10) / 10,
      ratingCount: r.rating_count,
    })),
  });
}
