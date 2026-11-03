import { businessOwner, seedDeadlines } from "@/lib/business";
import { getDb } from "@/lib/db";

const GENERIC_ERROR = "Could not load the business profile. Please try again.";

/** The owner's company profile (null until they save it once). */
export async function GET() {
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  try {
    const rows = (await getDb().query("SELECT * FROM business_profiles WHERE user_id = $1", [
      owner.id,
    ])) as Array<Record<string, unknown>>;
    return Response.json({ profile: rows[0] ?? null });
  } catch (err) {
    console.error(`business profile read failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
}

const TYPES = ["online_seller", "shop", "workshop", "other"];

/** Save the profile; first save also seeds the starter deadlines. */
export async function PUT(req: Request) {
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  const businessType = typeof body.business_type === "string" ? body.business_type : "other";
  if (!TYPES.includes(businessType)) {
    return Response.json({ detail: "Unknown business type." }, { status: 400 });
  }
  const name = typeof body.business_name === "string" ? body.business_name.slice(0, 120).trim() : "";
  const city = typeof body.city === "string" ? body.city.slice(0, 80).trim() : "";
  const turnover = typeof body.turnover_band === "string" ? body.turnover_band.slice(0, 40) : "unknown";
  const headcount = typeof body.headcount_band === "string" ? body.headcount_band.slice(0, 40) : "unknown";
  const regulated = body.regulated_goods === true;
  const customerData = body.holds_customer_data === true;
  try {
    const created = (await getDb().query(
      `INSERT INTO business_profiles
         (user_id, business_name, business_type, city, turnover_band, headcount_band,
          regulated_goods, holds_customer_data, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (user_id) DO UPDATE SET
         business_name = EXCLUDED.business_name, business_type = EXCLUDED.business_type,
         city = EXCLUDED.city, turnover_band = EXCLUDED.turnover_band,
         headcount_band = EXCLUDED.headcount_band, regulated_goods = EXCLUDED.regulated_goods,
         holds_customer_data = EXCLUDED.holds_customer_data, updated_at = now()
       RETURNING (xmax = 0) AS created`,
      [owner.id, name, businessType, city, turnover, headcount, regulated, customerData],
    )) as Array<{ created: boolean }>;
    if (created[0]?.created) await seedDeadlines(owner.id, customerData);
    const rows = (await getDb().query("SELECT * FROM business_profiles WHERE user_id = $1", [
      owner.id,
    ])) as Array<Record<string, unknown>>;
    return Response.json({ profile: rows[0] ?? null });
  } catch (err) {
    console.error(`business profile save failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 500 });
  }
}
