"use client";

import { useState } from "react";

const ITEMS = [
  {
    q: "Where do the answers come from?",
    a: "Straight from Bangladesh's statute books: the acts published on bdlaws. LegalBuddy searches them section by section, then answers only from what it finds. If nothing relevant turns up, it tells you that instead of guessing.",
  },
  {
    q: "Legal wording confuses me. Will I understand the answers?",
    a: "That's the whole point. Ask in your own words and the answer comes back in simple sentences, with the exact section attached so you can see where every claim came from.",
  },
  {
    q: "What does a citation actually give me?",
    a: "The act and year, the section number and heading, the exact passage the answer relied on, and a link to the full act so you can read around it.",
  },
  {
    q: "Can this replace my lawyer?",
    a: "No, and it won't pretend otherwise. It's the fast first step: finding and quoting the right provisions. What those provisions mean for your situation is still a conversation for counsel.",
  },
  {
    q: "Do you keep my questions?",
    a: "This demo keeps no accounts and no chat history. Still, don't paste anything private: case details, names, NIDs. Ask about the rule, not your case.",
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
