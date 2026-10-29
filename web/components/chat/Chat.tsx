"use client";

import { useEffect, useRef, useState } from "react";
import { FRIENDLY_ERROR, SUGGESTIONS } from "@/lib/chat-copy";
import { useChatStore } from "@/stores/chat-store";
import AnswerMarkdown from "./AnswerMarkdown";
import SourceCard from "./SourceCard";
import ThinkingDots from "./ThinkingDots";

/** Conversation view. State lives in the chat store; this module owns
 * only input focus, scroll following, and layout.
 */
export default function Chat() {
  const messages = useChatStore((s) => s.messages);
  const pending = useChatStore((s) => s.pending);
  const failed = useChatStore((s) => s.failed);
  const flash = useChatStore((s) => s.flash);
  const expandedRef = useChatStore((s) => s.expandedRef);
  const send = useChatStore((s) => s.send);
  const dismissError = useChatStore((s) => s.dismissError);
  const jumpTo = useChatStore((s) => s.jumpTo);
  const toggleSource = useChatStore((s) => s.toggleSource);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Don't yank the reader: only follow while already near the bottom.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  function submit(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setInput("");
    void send(q);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 && !pending ? (
          <div className="mx-auto max-w-xl pt-6">
            <p className="font-display text-xl text-stone-100">What&apos;s going on? Ask it plainly.</p>
            <p className="mt-2 text-sm leading-relaxed text-stone-400">
              Describe the problem the way you&apos;d tell a friend. You&apos;ll get it back
              in simple sentences, each pointing to the exact section behind it.
            </p>
            <div className="mt-4 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="block w-full rounded-md border border-stone-800 bg-stone-900/40 px-3 py-2.5 text-left text-sm text-stone-300 transition-colors hover:border-gold/50 hover:text-stone-100"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] rounded-lg bg-gold px-4 py-2.5 text-sm leading-relaxed text-ink">
                  {msg.text}
                </p>
              </div>
            ) : (
              <div
                key={i}
                className="max-w-[95%] lg:grid lg:max-w-full lg:grid-cols-[minmax(0,1fr)_250px] lg:items-start lg:gap-4"
              >
                <div className="min-w-0 rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-3 text-sm leading-relaxed text-stone-200">
                  {msg.text ? (
                    <AnswerMarkdown text={msg.text} onCite={jumpTo} />
                  ) : (
                    <p className="flex items-center gap-2 text-stone-400">
                      Consulting the statutes <ThinkingDots />
                    </p>
                  )}
                </div>
                {msg.citations && msg.citations.length > 0 ? (
                  <aside aria-label="Sources" className="mt-2 min-w-0 lg:mt-0">
                    <p className="mb-1.5 hidden text-xs font-semibold tracking-wider text-stone-500 uppercase lg:block">
                      Sources · {msg.citations.length}
                    </p>
                    <div className="space-y-2 lg:sticky lg:top-24">
                      {msg.citations.map((c) => (
                        <SourceCard
                          key={c.ref}
                          citation={c}
                          open={expandedRef === c.ref}
                          flash={flash === c.ref}
                          onToggle={() => toggleSource(c.ref)}
                        />
                      ))}
                    </div>
                  </aside>
                ) : null}
              </div>
            ),
          )
        )}
        {failed ? (
          <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {FRIENDLY_ERROR}{" "}
            <button onClick={dismissError} className="font-medium underline">
              Dismiss
            </button>
          </div>
        ) : null}
      </div>

      <div className="border-t border-stone-800/80 bg-ink px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            placeholder="Ask in your own words…"
            disabled={pending}
            aria-label="Ask a legal question"
            className="min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none disabled:opacity-60"
          />
          <button
            onClick={() => submit(input)}
            disabled={pending || input.trim().length === 0}
            className="shrink-0 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
          >
            Ask
          </button>
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] leading-relaxed text-stone-500">
          LegalBuddy can make mistakes. Check important claims against the linked act.
        </p>
      </div>
    </div>
  );
}
