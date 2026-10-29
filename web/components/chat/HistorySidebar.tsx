"use client";

import { useEffect, useState } from "react";
import { useChatStore } from "@/stores/chat-store";

/** Left rail: new chat plus recent conversations. A static column on
 * desktop, a slide-over drawer on small screens.
 */
export default function HistorySidebar() {
  const open = useChatStore((s) => s.historyOpen);
  const activeId = useChatStore((s) => s.activeId);
  const conversations = useChatStore((s) => s.conversations);
  const pending = useChatStore((s) => s.pending);
  const historyLoading = useChatStore((s) => s.historyLoading);
  const refreshConversations = useChatStore((s) => s.refreshConversations);
  const newChat = useChatStore((s) => s.newChat);
  const openConversation = useChatStore((s) => s.openConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const setHistoryOpen = useChatStore((s) => s.setHistoryOpen);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    void refreshConversations();
    // The rail starts open on desktop; on phones it would cover the
    // chat, so start shut there.
    if (window.innerWidth < 768) setHistoryOpen(false);
  }, [refreshConversations, setHistoryOpen]);

  if (!open) return null;

  function commitRename(id: string) {
    void renameConversation(id, renameValue);
    setRenamingId(null);
  }

  const list = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <button
          onClick={() => {
            newChat();
            if (window.innerWidth < 768) setHistoryOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-md border border-stone-700/80 px-3 py-2 text-sm font-medium text-stone-200 transition-colors hover:border-gold/60 hover:text-stone-100"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New chat
        </button>
      </div>
      <p className="px-4 pb-1 text-[11px] font-medium tracking-wide text-stone-500 uppercase">
        Recent
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {historyLoading && conversations.length === 0 ? (
          <p className="px-2 py-2 text-xs text-stone-500">Loading chats…</p>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-2 text-xs leading-relaxed text-stone-500">
            Nothing saved yet. Your chats will appear here.
          </p>
        ) : (
          conversations.map((c) => {
            const active = c.id === activeId;
            return (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-md px-2 py-2 text-sm transition-colors ${
                  active ? "bg-stone-800/80 text-stone-100" : "text-stone-400 hover:bg-stone-800/50 hover:text-stone-200"
                }`}
              >
                {renamingId === c.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(c.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="min-w-0 flex-1 rounded border border-gold/60 bg-ink px-1.5 py-0.5 text-sm text-stone-100 focus:outline-none"
                    aria-label="Rename conversation"
                  />
                ) : (
                  <button
                    onClick={() => {
                      void openConversation(c.id);
                      if (window.innerWidth < 768) setHistoryOpen(false);
                    }}
                    disabled={pending}
                    className="min-w-0 flex-1 truncate text-left disabled:cursor-wait"
                    title={c.title}
                  >
                    {c.title}
                  </button>
                )}
                {renamingId !== c.id && (
                  <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <button
                      onClick={() => {
                        setRenamingId(c.id);
                        setRenameValue(c.title);
                      }}
                      className="rounded p-1 text-stone-500 transition-colors hover:bg-stone-700/60 hover:text-stone-200"
                      title="Rename"
                      aria-label={`Rename ${c.title}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => void deleteConversation(c.id)}
                      className="rounded p-1 text-stone-500 transition-colors hover:bg-stone-700/60 hover:text-red-300"
                      title="Delete"
                      aria-label={`Delete ${c.title}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6" />
                      </svg>
                    </button>
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Backdrop: mobile drawer only. */}
      <div
        className="fixed inset-0 z-30 bg-black/60 md:hidden"
        onClick={() => setHistoryOpen(false)}
        aria-hidden="true"
      />
      <aside className="fixed inset-y-0 left-0 z-30 max-h-full w-72 border-r border-stone-800 bg-ink md:static md:z-auto md:w-64 md:shrink-0 md:border-stone-800/80">
        {list}
      </aside>
    </>
  );
}
