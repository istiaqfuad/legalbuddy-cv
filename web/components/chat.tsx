"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Citation, Language } from "@/lib/types";

const SUGGESTIONS = [
  "Which law allows the government to create new districts, and what does it say?",
  "What is the punishment for murder under the Penal Code?",
  "খুনের শাস্তি কী?",
];

function renderRich(text: string) {
  // Emphasize [n] citation markers so claims visibly tie to the cards below.
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) =>
    /^\[\d+\]$/.test(part) ? (
      <span key={i} className="font-semibold text-emerald-900">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function CitationCard({ citation }: { citation: Citation }) {
  const heading =
    citation.section_label && citation.section_label !== "?"
      ? `Section ${citation.section_label}`
      : "Provision";
  return (
    <article className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <p className="text-[13px] font-semibold text-stone-900">
        [{citation.ref}] {heading}
        {citation.section_title ? ` — ${citation.section_title}` : ""}
      </p>
      <p className="mt-0.5 text-xs text-stone-600">
        {citation.act_title} ({citation.act_no} of {citation.act_year})
      </p>
      <blockquote className="mt-2 border-l-2 border-emerald-800/40 pl-2.5 text-[13px] leading-relaxed text-stone-800">
        {citation.excerpt}
      </blockquote>
      {citation.source_url ? (
        <a
          href={citation.source_url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block text-xs font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950"
        >
          Read the full act on bdlaws.minlaw.gov.bd
        </a>
      ) : null}
    </article>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<Language>("auto");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, language: lang === "auto" ? null : lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? "Request failed");
      setMessages((m) => [
        ...m,
        { role: "assistant", text: data.answer, citations: data.citations ?? [] },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 && !pending ? (
          <div className="mx-auto max-w-xl pt-6">
            <p className="font-display text-xl text-stone-900">
              Ask about Bangladeshi law. Answers cite their sources.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              Every claim is grounded in retrieved statute sections. Each cited
              section shows its act, section number, the exact text relied on,
              and a link to the full act on bdlaws.
            </p>
            <div className="mt-4 space-y-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="block w-full rounded-md border border-stone-200 bg-white px-3 py-2.5 text-left text-sm text-stone-800 hover:border-emerald-800/50 hover:bg-emerald-50/40"
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
                <p className="max-w-[85%] rounded-lg bg-emerald-900 px-4 py-2.5 text-sm leading-relaxed text-white">
                  {msg.text}
                </p>
              </div>
            ) : (
              <div key={i} className="max-w-[95%]">
                <div className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-stone-900">
                  {renderRich(msg.text)}
                </div>
                {msg.citations && msg.citations.length > 0 ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
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
          <p className="text-sm text-stone-500 motion-safe:animate-pulse">
            Consulting the statutes…
          </p>
        ) : null}
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}{" "}
            <button onClick={() => setError(null)} className="font-medium underline">
              Dismiss
            </button>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-stone-200 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div
            role="group"
            aria-label="Answer language"
            className="flex shrink-0 overflow-hidden rounded-md border border-stone-200 text-xs"
          >
            {(["auto", "english", "bengali"] as Language[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
                className={`px-2.5 py-2 font-medium capitalize ${
                  lang === l
                    ? "bg-stone-900 text-white"
                    : "bg-white text-stone-600 hover:bg-stone-100"
                }`}
              >
                {l === "english" ? "EN" : l === "bengali" ? "বাং" : "Auto"}
              </button>
            ))}
          </div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask a legal question…"
            disabled={pending}
            className="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-800 focus:ring-1 focus:ring-emerald-800 focus:outline-none disabled:bg-stone-100"
          />
          <button
            onClick={() => send(input)}
            disabled={pending || input.trim().length === 0}
            className="shrink-0 rounded-md bg-emerald-900 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-950 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}
