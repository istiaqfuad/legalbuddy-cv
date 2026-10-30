"use client";

import type { Citation } from "@/lib/types";

/** One source in the rail. Collapsed to a single line by default so the
 * answer keeps the reader's attention; expands on tap, or when its [n]
 * (or [Dn] for user files) marker in the prose is clicked.
 */
export default function SourceCard({
  citation,
  cardKey,
  open,
  flash,
  onToggle,
}: {
  citation: Citation;
  cardKey: string;
  open: boolean;
  flash: boolean;
  onToggle: () => void;
}) {
  const isDoc = citation.kind === "document";
  const heading = isDoc
    ? citation.doc_filename || "Your file"
    : citation.section_label && citation.section_label !== "?"
      ? `Section ${citation.section_label}`
      : "Provision";
  const sub = isDoc
    ? (citation.doc_page ? `Page ${citation.doc_page} · your file` : "Your file")
    : `${citation.act_title} (${citation.act_no} of ${citation.act_year})`;
  return (
    <article
      id={`cite-card-${cardKey}`}
      className={`scroll-mt-24 rounded-lg border bg-stone-900/60 transition-colors ${
        flash ? "border-gold/70" : "border-stone-800"
      }`}
    >
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold text-stone-100">
            [{isDoc ? `D${citation.ref}` : citation.ref}] {heading}
          </span>
          <span className="block truncate text-[11px] text-stone-500">{sub}</span>
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-base leading-none text-gold transition-transform duration-200 ${
            open ? "rotate-45" : ""
          }`}
        >
          +
        </span>
      </button>
      {open ? (
        <div className="px-3 pb-3">
          {citation.section_title ? (
            <p className="text-xs font-medium text-stone-300">{citation.section_title}</p>
          ) : null}
          <blockquote className="mt-1.5 border-l-2 border-gold/60 pl-2.5 text-[13px] leading-relaxed text-stone-300">
            {citation.excerpt}
          </blockquote>
          {citation.source_url ? (
            <a
              href={citation.source_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-block text-xs font-medium text-gold-light underline underline-offset-2 hover:text-gold"
            >
              Full act on bdlaws
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
