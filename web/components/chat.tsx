"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Citation } from "@/lib/types";

const SUGGESTIONS = [
  "Which law allows the government to create new districts, and what does it say?",
  "What is the punishment for murder under the Penal Code?",
  "খুনের শাস্তি কী?",
];

/** Shown for every failure. Upstream details stay in server logs. */
const FRIENDLY_ERROR = "The assistant is unavailable right now. Please try again in a moment.";

function renderRich(text: string) {
  // Emphasize [n] citation markers so claims visibly tie to the cards below.
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) =>
    /^\[\d+\]$/.test(part) ? (
      <span key={i} className="font-semibold text-gold-light">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function CitationCard({ citation }: { citation: Citation }) {
  const heading =
    citation.section_label && citation.section_label !== "?" ? `Section ${citation.section_label}` : "Provision";
  return (
    <article className="rounded-lg border border-stone-800 bg-stone-900/60 p-3">
      <p className="text-[13px] font-semibold text-stone-100">
        [{citation.ref}] {heading}
        {citation.section_title ? ` — ${citation.section_title}` : ""}
      </p>
      <p className="mt-0.5 text-xs text-stone-500">
        {citation.act_title} ({citation.act_no} of {citation.act_year})
      </p>
      <blockquote className="mt-2 border-l-2 border-gold/60 pl-2.5 text-[13px] leading-relaxed text-stone-300">
        {citation.excerpt}
      </blockquote>
      {citation.source_url ? (
        <a
          href={citation.source_url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs font-medium text-gold-light underline underline-offset-2 hover:text-gold"
        >
          Read the full act on bdlaws.minlaw.gov.bd
        </a>
      ) : null}
    </article>
  );
}

function ThinkingDots() {
  return (
    <span aria-hidden className="inline-flex gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block size-1.5 rounded-full bg-stone-400 motion-safe:animate-[blink-dot_1.2s_infinite]"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </span>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setFailed(false);
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No language is sent: retrieval matches English, Bangla, and mixed
        // queries automatically; the answer follows the question's language.
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      if (typeof data.answer !== "string") throw new Error("bad shape");
      setMessages((m) => [
        ...m,
        { role: "assistant", text: data.answer, citations: data.citations ?? [] },
      ]);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 && !pending ? (
          <div className="mx-auto max-w-xl pt-6">
            <p className="font-display text-xl text-stone-100">
              Ask in English, Bangla, or both at once.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-stone-400">
              Every claim is grounded in retrieved statute sections. Each cited section shows its
              act, section number, the exact text relied on, and a link to the full act.
            </p>
            <div className="mt-4 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
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
              <div key={i} className="max-w-[95%]">
                <div className="rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-stone-200">
                  {renderRich(msg.text)}
                </div>
                {msg.citations && msg.citations.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs font-semibold tracking-wider text-stone-500 uppercase">
                      Cited sections
                    </p>
                    {msg.citations.map((c) => (
                      <CitationCard key={c.ref} citation={c} />
                    ))}
                  </div>
                ) : null}
              </div>
            ),
          )
        )}
        {pending ? (
          <p className="flex items-center gap-2 text-sm text-stone-400">
            Consulting the statutes <ThinkingDots />
          </p>
        ) : null}
        {failed ? (
          <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {FRIENDLY_ERROR}{" "}
            <button onClick={() => setFailed(false)} className="font-medium underline">
              Dismiss
            </button>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-stone-800/80 bg-ink px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask in English, বাংলা, or both…"
            disabled={pending}
            aria-label="Ask a legal question"
            className="min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none disabled:opacity-60"
          />
          <button
            onClick={() => send(input)}
            disabled={pending || input.trim().length === 0}
            className="shrink-0 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-gold-light disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}
