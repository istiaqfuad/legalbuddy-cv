/** Shown instantly while /chat server-renders, so a click never feels dead. */
export default function Loading() {
  return (
    <div
      aria-busy="true"
      aria-label="Opening the chat"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 py-20"
    >
      <p className="flex items-center gap-1.5 text-sm text-stone-400 motion-safe:animate-pulse">
        Opening the law library
        <span aria-hidden className="inline-flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block size-1 rounded-full bg-stone-500 motion-safe:animate-[blink-dot_1.2s_infinite]"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </span>
      </p>
      <div className="w-full max-w-xl space-y-2" aria-hidden>
        <div className="h-10 rounded-md border border-stone-800 bg-stone-900/40" />
        <div className="h-16 w-11/12 rounded-lg border border-stone-800 bg-stone-900/40" />
        <div className="ml-auto h-10 w-2/3 rounded-lg border border-stone-800 bg-stone-900/40" />
      </div>
    </div>
  );
}
