import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { businessOwner } from "@/lib/business";
import { internalBase, internalHeaders } from "@/lib/internal-api";

const GENERIC_ERROR = "The review could not run. Please try again.";

/** Run the grounded contract review over one vault file. */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return Response.json({ detail: "Sign in required." }, { status: 401 });
  const owner = await businessOwner();
  if (!owner) return Response.json({ detail: "Business plan required." }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "Request body must be JSON." }, { status: 400 });
  }
  const docId = typeof body.doc_id === "string" ? body.doc_id : "";
  if (!docId) return Response.json({ detail: "Choose a document first." }, { status: 400 });
  try {
    const upstream = await fetch(
      `${internalBase()}/api/contract-review?${new URLSearchParams({ doc_id: docId, user_id: owner.id })}`,
      { method: "POST", headers: internalHeaders(), signal: AbortSignal.timeout(180_000) },
    );
    const data = await upstream.json().catch(() => null);
    if (!upstream.ok || !data) {
      const detail = typeof data?.detail === "string" ? data.detail : GENERIC_ERROR;
      return Response.json({ detail }, { status: upstream.ok ? 500 : upstream.status });
    }
    return Response.json({ doc_id: data.doc_id, flags: data.flags ?? [], note: data.note ?? "" });
  } catch (err) {
    console.error(`business contract review failed: ${err instanceof Error ? err.message : err}`);
    return Response.json({ detail: GENERIC_ERROR }, { status: 502 });
  }
}
