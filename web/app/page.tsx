import Chat from "@/components/chat";

// Live index status must never be prerendered at build time.
export const dynamic = "force-dynamic";

async function getIndexStatus(): Promise<{ points: number | null; live: boolean }> {
  const base = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${base}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { points: null, live: false };
    const data = await res.json();
    return {
      points: typeof data.points === "number" ? data.points : null,
      live: data.status === "ok",
    };
  } catch {
    return { points: null, live: false };
  }
}

export default async function Home() {
  const { points, live } = await getIndexStatus();

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="bg-emerald-950 text-white">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 sm:px-6">
          <div>
            <h1 className="font-display text-2xl leading-tight">LegalBuddy</h1>
            <p className="text-[13px] text-emerald-100/80">
              Bangladesh statute research assistant
            </p>
          </div>
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
              live ? "bg-emerald-900 text-emerald-100" : "bg-stone-700 text-stone-200"
            }`}
          >
            <span
              className={`inline-block size-1.5 rounded-full ${live ? "bg-emerald-300" : "bg-stone-400"}`}
            />
            {live && points !== null
              ? `${points.toLocaleString()} sections indexed`
              : "index offline"}
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col">
        <Chat />
      </main>

      <footer className="border-t border-stone-200">
        <p className="mx-auto max-w-3xl px-4 py-3 text-center text-xs text-stone-500 sm:px-6">
          Research assistance only — not a substitute for a lawyer. Answers are
          generated from retrieved statute sections; always verify against the
          linked act.
        </p>
      </footer>
    </div>
  );
}
