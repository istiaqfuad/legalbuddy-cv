"use client";

import { useChatStore } from "@/stores/chat-store";
import SourceCard from "./SourceCard";

/** Cited-sections sidebar. Closed by default; opens on demand with every
 * card collapsed except the one that opened it.
 *
 * Two modes: a floating drawer (default, slides over on any screen) and a
 * pinned right rail (desktop only, the conversation reflows beside it).
 * The pin toggle switches modes; closing hides it entirely.
 */
export default function SourcesSidebar() {
  const open = useChatStore((s) => s.sidebarOpen);
  const pinned = useChatStore((s) => s.sidebarPinned);
  const citations = useChatStore((s) => s.sidebarCitations);
  const flash = useChatStore((s) => s.flash);
  const expandedRef = useChatStore((s) => s.expandedRef);
  const closeSidebar = useChatStore((s) => s.closeSidebar);
  const togglePin = useChatStore((s) => s.togglePin);
  const toggleSource = useChatStore((s) => s.toggleSource);

  if (!open) return null;

  const cards = (
    <div className="space-y-2">
      {citations.map((c) => (
        <SourceCard
          key={c.ref}
          citation={c}
          open={expandedRef === c.ref}
          flash={flash === c.ref}
          onToggle={() => toggleSource(c.ref)}
        />
      ))}
    </div>
  );

  const header = (
    <div className="mb-3 flex items-center gap-2">
      <p className="text-xs font-semibold tracking-wider text-stone-400 uppercase">
        Cited sections · {citations.length}
      </p>
      <div className="ml-auto flex items-center gap-1">
        <button
          onClick={togglePin}
          aria-pressed={pinned}
          title={pinned ? "Unpin panel" : "Pin panel to the side"}
          className={`cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            pinned
              ? "bg-gold/15 text-gold-light"
              : "text-stone-500 hover:bg-stone-800 hover:text-stone-200"
          } hidden lg:block`}
        >
          {pinned ? "Unpin" : "Pin"}
        </button>
        <button
          onClick={closeSidebar}
          aria-label="Close sources panel"
          className="cursor-pointer rounded-md px-2 py-1 text-lg leading-none text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200"
        >
          ×
        </button>
      </div>
    </div>
  );

  if (pinned) {
    return (
      <aside
        aria-label="Cited sections"
        className="hidden max-h-full w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-stone-800/80 bg-ink px-5 py-6 lg:flex"
      >
        {header}
        {cards}
      </aside>
    );
  }

  return (
    <>
      <div
        aria-hidden
        onClick={closeSidebar}
        className="fixed inset-0 z-30 bg-black/60 motion-safe:animate-[fade-in_0.2s_ease-out]"
      />
      <aside
        aria-label="Cited sections"
        className="fixed inset-y-0 right-0 z-40 flex w-80 max-w-[85vw] flex-col overflow-y-auto border-l border-stone-800 bg-[#101010] px-4 py-4 motion-safe:animate-[slide-in-right_0.25s_ease-out]"
      >
        {header}
        {cards}
      </aside>
    </>
  );
}
