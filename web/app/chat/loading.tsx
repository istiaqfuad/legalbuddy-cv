import SiteHeader from "@/components/site-header";

/** Shown instantly while /chat server-renders, so a click never feels dead.
 * Mirrors the chat page shell (header, status strip, message area, input
 * bar) so the real content swaps in with zero layout shift.
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader />
      <div className="border-b border-stone-800/80">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2 text-xs text-stone-500 sm:px-6">
          <span className="inline-block size-1.5 rounded-full bg-stone-500 motion-safe:animate-pulse" />
          Opening the law library
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col">
        <div
          aria-busy="true"
          aria-label="Opening the chat"
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 space-y-5 px-4 py-6 sm:px-6" aria-hidden>
            <div className="ml-auto h-10 w-2/3 rounded-lg border border-stone-800 bg-stone-900/40" />
            <div className="h-24 w-11/12 rounded-lg border border-stone-800 bg-stone-900/40" />
            <div className="h-10 w-1/2 rounded-lg border border-stone-800 bg-stone-900/40" />
          </div>
          <div className="border-t border-stone-800/80 px-4 py-3 sm:px-6" aria-hidden>
            <div className="mx-auto flex max-w-3xl items-center gap-2">
              <div className="h-9 flex-1 rounded-md border border-stone-800 bg-stone-900/40" />
              <div className="h-9 w-16 rounded-md border border-stone-800 bg-stone-900/40" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
