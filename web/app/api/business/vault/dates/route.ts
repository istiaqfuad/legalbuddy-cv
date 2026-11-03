import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { businessOwner } from "@/lib/business";
import { internalBase, internalHeaders } from "@/lib/internal-api";

const GENERIC_ERROR = "Could not read the document. Please try again.";

/** Suggested expiry dates for one vault file, from its stored text. */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  const docId = new URL(req.url).searchParams.get("docId") ?? "";
  if (!docId) return Response.json({ detail: "Choose a document first." }, { status: 400 });
  try {
    const upstream = await fetch(
      `${internalBase()}/api/documents/${encodeURIComponent(docId)}/dates?user_id=${encodeURIComponent(owner.id)}`,
      { headers: internalHeaders(), signal: AbortSignal.timeout(60_000) },
    );
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || !Array.isArray(data)) {
      return Response.json({ detail: GENERIC_ERROR }, { status: upstream.ok ? 500 : upstream.status });
    }
    return Response.json({ suggestions: data });
  } catch (err) {
    console.error(`business vault dates failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 502 });
  }
}
