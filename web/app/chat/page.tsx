import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Chat from "@/components/chat/Chat";
import SiteHeader from "@/components/site-header";

// Live index status must never be prerendered at build time.
export const dynamic = "force-dynamic";

async function getIndexStatus(): Promise<{ live: boolean }> {
  const base = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { live: false };
    const data = await res.json();
    return { live: data.status === "ok" };
  } catch {
    return { live: false };
  }
}

export default async function ChatPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const { live } = await getIndexStatus();

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader />
      <div className="border-b border-stone-800/80">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2 text-xs text-stone-500 sm:px-6">
          <span
            className={`inline-block size-1.5 rounded-full ${
              live ? "bg-emerald-400 motion-safe:animate-pulse" : "bg-stone-500"
            }`}
          />
          {live ? "Connected to the law library" : "Having trouble reaching the library"}
        </div>
      </div>

      <main className="flex w-full min-h-0 flex-1 flex-col">
        <Chat />
      </main>
    </div>
  );
}
