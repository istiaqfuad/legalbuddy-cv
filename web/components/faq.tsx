"use client";

import { useState } from "react";

const ITEMS = [
  {
    q: "Where do the answers come from?",
    a: "Only from the text of Bangladeshi statutes published on bdlaws.minlaw.gov.bd, chunked section-by-section and searched with hybrid dense + sparse retrieval. If the evidence doesn't support an answer, LegalBuddy says so instead of guessing.",
  },
  {
    q: "Which language should I ask in?",
    a: "Whichever comes naturally — English, Bangla, or a mix of both in one question. There is no language setting; every query is embedded and matched across both languages automatically, and the answer follows your question's language.",
  },
  {
    q: "What exactly is a citation here?",
    a: "Each cited section shows the act title and year, the section number and heading, the exact excerpt the answer relied on, and a link to the full act. The section label plus excerpt pinpoints the provision, since bdlaws pages have no per-section links.",
  },
  {
    q: "Can I rely on this instead of a lawyer?",
    a: "No. LegalBuddy is research assistance: it finds and quotes the relevant provisions fast, but it can't weigh facts, jurisdiction, or amendments the way counsel does. Every answer ends with that reminder — verify against the linked act.",
  },
  {
    q: "Is my question stored anywhere?",
    a: "Questions pass through the answer service to retrieve statutes and generate the reply; this demo keeps no accounts and no chat history. Don't paste private case details you'd be uncomfortable sharing.",
  },
];

export default function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="divide-y divide-stone-800/80 rounded-xl border border-stone-800/80">
      {ITEMS.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.q}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="font-medium text-stone-100">{item.q}</span>
              <span
                aria-hidden
                className={`shrink-0 text-xl leading-none text-gold transition-transform duration-200 ${
                  isOpen ? "rotate-45" : ""
                }`}
              >
                +
              </span>
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                isOpen ? "[grid-template-rows:1fr]" : "[grid-template-rows:0fr]"
              }`}
            >
              <div className="overflow-hidden">
                <p className="px-5 pb-5 text-sm leading-relaxed text-stone-400">{item.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
