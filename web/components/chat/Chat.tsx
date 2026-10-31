"use client";

import { useEffect, useRef, useState } from "react";
import { FRIENDLY_ERROR, SUGGESTIONS, conversationToMarkdown } from "@/lib/chat-copy";
import { useChatStore } from "@/stores/chat-store";
import AnswerMarkdown from "./AnswerMarkdown";
import HistorySidebar from "./HistorySidebar";
import SourcesSidebar from "./SourcesSidebar";
import ThinkingDots from "./ThinkingDots";

const ACCEPTED_FILES = ".pdf,.docx,.txt,.md";

/** Conversation view. Owns input focus, scroll following, and layout.
 * All conversation state lives in the chat store; cited sections live
 * in the sidebar and appear only on demand.
 */
export default function Chat() {
  const messages = useChatStore((s) => s.messages);
  const pending = useChatStore((s) => s.pending);
  const failed = useChatStore((s) => s.failed);
  const quotaExceeded = useChatStore((s) => s.quotaExceeded);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const regenerate = useChatStore((s) => s.regenerate);
  const dismissError = useChatStore((s) => s.dismissError);
  const openSources = useChatStore((s) => s.openSources);
  const newChat = useChatStore((s) => s.newChat);
  const toggleHistory = useChatStore((s) => s.toggleHistory);
  const attachedIds = useChatStore((s) => s.attachedIds);
  const documents = useChatStore((s) => s.documents);
  const uploading = useChatStore((s) => s.uploading);
  const uploadError = useChatStore((s) => s.uploadError);
  const activeId = useChatStore((s) => s.activeId);
  const conversations = useChatStore((s) => s.conversations);
  const refreshDocuments = useChatStore((s) => s.refreshDocuments);
  const uploadDocument = useChatStore((s) => s.uploadDocument);
  const attachDocument = useChatStore((s) => s.attachDocument);
  const detachDocument = useChatStore((s) => s.detachDocument);
  const removeDocument = useChatStore((s) => s.removeDocument);

  const [input, setInput] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refreshDocuments();
  }, [refreshDocuments]);

  const attached = attachedIds.flatMap((id) => {
    const doc = documents.find((d) => d.doc_id === id);
    return doc ? [doc] : [];
  });
  const libraryUnattached = documents.filter((d) => !attachedIds.includes(d.doc_id));

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

  function exportChat() {
    if (messages.length === 0) return;
    const title =
      conversations.find((c) => c.id === activeId)?.title ?? "LegalBuddy chat";
    const md = conversationToMarkdown(messages, title);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `legalbuddy-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function copyText(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked (permissions, insecure context): fall back to
      // a temporary selection so copy still works.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(index);
    setTimeout(() => setCopied((c) => (c === index ? null : c)), 1500);
  }

  const lastAssistantIdx = messages.map((m) => m.role).lastIndexOf("assistant");

  return (
    <div className="flex min-h-0 flex-1">
      <HistorySidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1 border-b border-stone-800/60 px-2 py-1.5 sm:px-4">
          <button
            onClick={toggleHistory}
            className="rounded-md p-2 text-stone-400 transition-colors hover:bg-stone-800/60 hover:text-stone-100"
            title="Toggle chat history"
            aria-label="Toggle chat history"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </button>
          <button
            onClick={exportChat}
            disabled={pending || messages.length === 0}
            className="rounded-md p-2 text-stone-400 transition-colors hover:bg-stone-800/60 hover:text-stone-100 disabled:opacity-40"
            title="Download this chat as Markdown"
            aria-label="Download this chat as Markdown"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="m7 10 5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
          </button>
          <button
            onClick={newChat}
            className="rounded-md p-2 text-stone-400 transition-colors hover:bg-stone-800/60 hover:text-stone-100 disabled:opacity-40"
            title="Start a new chat"
            aria-label="Start a new chat"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
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
                <div key={i} className="w-full">
                  <div className="rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-3 text-sm leading-relaxed text-stone-200">
                    {msg.text ? (
                      <AnswerMarkdown
                        text={msg.text}
                        onCite={(key) => openSources(msg.citations ?? [], key)}
                      />
                    ) : (
                      <p className="flex items-center gap-2 text-stone-400">
                        Consulting the statutes <ThinkingDots />
                      </p>
                    )}
                  </div>
                  {!pending && msg.text ? (
                    <div className="mt-1.5 flex items-center gap-1">
                      <button
                        onClick={() => void copyText(msg.text, i)}
                        className="rounded p-1.5 text-stone-500 transition-colors hover:bg-stone-800/60 hover:text-stone-200"
                        title={copied === i ? "Copied" : "Copy answer"}
                        aria-label={copied === i ? "Copied" : "Copy answer"}
                      >
                        {copied === i ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>
                      {i === lastAssistantIdx ? (
                        <button
                          onClick={() => void regenerate()}
                          className="rounded p-1.5 text-stone-500 transition-colors hover:bg-stone-800/60 hover:text-stone-200"
                          title="Regenerate answer"
                          aria-label="Regenerate answer"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
                            <path d="M21 3v5h-5" />
                            <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
                            <path d="M3 21v-5h5" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {!pending && msg.citations && msg.citations.length > 0 ? (
                    <button
                      onClick={() => openSources(msg.citations ?? [], null)}
                      className="mt-1 cursor-pointer text-xs font-medium text-stone-500 transition-colors hover:text-gold-light"
                    >
                      {(() => {
                        const laws = msg.citations.filter((c) => c.kind !== "document").length;
                        const files = msg.citations.length - laws;
                        return files > 0
                          ? `Sources · ${laws} law · ${files} your file${files > 1 ? "s" : ""} →`
                          : `Sources · ${msg.citations.length} cited sections →`;
                      })()}
                    </button>
                  ) : null}
                </div>
              ),
            )
          )}
          {failed ? (
            <div className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {quotaExceeded ? (
                <>
                  You have reached today&apos;s free answer limit.{" "}
                  <a href="/pricing" className="font-medium underline">
                    Upgrade for unlimited answers
                  </a>
                  .{" "}
                </>
              ) : (
                <>{FRIENDLY_ERROR} </>
              )}
              <button onClick={dismissError} className="font-medium underline">
                Dismiss
              </button>
            </div>
          ) : null}
          </div>
        </div>

        <div className="border-t border-stone-800/80 bg-ink px-4 py-3 sm:px-6">
          {(attached.length > 0 || uploadError) && (
            <div className="mx-auto mb-2 flex max-w-3xl flex-wrap items-center gap-1.5">
              {attached.map((d) => (
                <span
                  key={d.doc_id}
                  className="flex max-w-56 items-center gap-1.5 rounded-md border border-gold/40 bg-gold/15 px-2 py-1 text-xs text-stone-200"
                  title={`${d.filename} · attached to this chat`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                    <path d="M14 2v6h6" />
                  </svg>
                  <span className="truncate">{d.filename}</span>
                  <button
                    onClick={() => void detachDocument(d.doc_id)}
                    className="shrink-0 rounded text-stone-400 transition-colors hover:text-stone-100"
                    title={`Detach ${d.filename}`}
                    aria-label={`Detach ${d.filename}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {uploadError ? <span className="text-xs text-red-300">{uploadError}</span> : null}
            </div>
          )}
          {showLibrary && libraryUnattached.length > 0 ? (
            <div className="mx-auto mb-2 max-w-3xl rounded-md border border-stone-800 bg-stone-900/60 p-2">
              <p className="px-1 pb-1 text-[11px] font-medium tracking-wide text-stone-500 uppercase">
                Your files
              </p>
              {libraryUnattached.map((d) => (
                <div key={d.doc_id} className="flex items-center gap-2 rounded px-1 py-1.5 hover:bg-stone-800/60">
                  <button
                    onClick={() => {
                      void attachDocument(d.doc_id);
                      setShowLibrary(false);
                    }}
                    className="min-w-0 flex-1 truncate text-left text-sm text-stone-200"
                    title={`Attach ${d.filename}`}
                  >
                    {d.filename}
                  </button>
                  <button
                    onClick={() => void removeDocument(d.doc_id)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs text-stone-500 transition-colors hover:text-red-300"
                    title={`Delete ${d.filename} everywhere`}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_FILES}
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void uploadDocument(f);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={pending || uploading}
              className="shrink-0 rounded-md p-2 text-stone-400 transition-colors hover:bg-stone-800/60 hover:text-stone-100 disabled:opacity-40"
              title="Attach a file (PDF, Word, text, Markdown)"
              aria-label="Attach a file"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              onClick={() => setShowLibrary((v) => !v)}
              disabled={pending || documents.length === 0}
              className="shrink-0 rounded-md p-2 text-stone-400 transition-colors hover:bg-stone-800/60 hover:text-stone-100 disabled:opacity-40"
              title={documents.length === 0 ? "No uploaded files yet" : "Attach from your files"}
              aria-label="Attach from your files"
              aria-expanded={showLibrary}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
              </svg>
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              placeholder={uploading ? "Reading your file…" : "Ask in your own words…"}
              disabled={pending || uploading}
              aria-label="Ask a legal question"
              className="min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none disabled:opacity-60"
            />
            {pending ? (
              <button
                onClick={stop}
                className="shrink-0 rounded-md border border-stone-600 px-4 py-2 text-sm font-semibold text-stone-200 transition-all hover:border-stone-400 active:scale-[0.97]"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={() => submit(input)}
                disabled={input.trim().length === 0}
                className="shrink-0 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.97] disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
              >
                Ask
              </button>
            )}
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] leading-relaxed text-stone-500">
            LegalBuddy can make mistakes. Check important claims against the linked act.
          </p>
        </div>
      </div>
      <SourcesSidebar />
    </div>
  );
}
