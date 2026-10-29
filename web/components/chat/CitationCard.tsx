"use client";

import { useState } from "react";
import type { Citation } from "@/lib/types";

/** A cited section. Starts open: the answer just pointed at it.
 * The heading toggles it shut once read.
 */
export default function CitationCard({
  citation,
  flash,
}: {
  citation: Citation;
  flash: boolean;
}) {
  const [open, setOpen] = useState(true);
  const heading =
    citation.section_label && citation.section_label !== "?"
      ? `Section ${citation.section_label}`
      : "Provision";
  return (
    <article
      id={`cite-card-${citation.ref}`}
      className={`scroll-mt-4 rounded-lg border bg-stone-900/60 p-3 transition-colors ${
        flash ? "border-gold/70" : "border-stone-800"
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span>
          <span className="text-[13px] font-semibold text-stone-100">
            [{citation.ref}] {heading}
            {citation.section_title ? `: ${citation.section_title}` : ""}
          </span>
          <span className="mt-0.5 block text-xs text-stone-500">
            {citation.act_title} ({citation.act_no} of {citation.act_year})
          </span>
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-lg leading-none text-gold transition-transform duration-200 ${
            open ? "rotate-45" : ""
          }`}
        >
          +
        </span>
      </button>
      {open ? (
        <>
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
        </>
      ) : null}
    </article>
  );
}
