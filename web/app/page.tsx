import Link from "next/link";
import Faq from "@/components/faq";
import Logo from "@/components/logo";
import SiteFooter from "@/components/site-footer";
import SiteHeader from "@/components/site-header";

const STEPS = [
  {
    n: "01",
    title: "Ask like you'd ask a friend",
    body: "No legal keywords needed. Just describe the problem the way you'd tell a friend, in the language you think in.",
  },
  {
    n: "02",
    title: "We find the exact sections",
    body: "LegalBuddy searches the statute books and pulls the provisions that speak to your question. Not blog posts or opinions. The law itself.",
  },
  {
    n: "03",
    title: "You get proof, not promises",
    body: "Every claim in the answer points to a cited section you can read yourself, with a link to the full act.",
  },
];

const WHO = [
  {
    title: "Renters",
    body: "Deposit fights, eviction threats, repairs your landlord keeps ignoring.",
  },
  {
    title: "Students",
    body: "Cite the exact section in assignments and moots instead of quoting a textbook's summary.",
  },
  {
    title: "Journalists",
    body: "Quote the provision itself, not someone's interpretation of it.",
  },
  {
    title: "Small businesses",
    body: "Licenses, contracts, and unpaid dues, without keeping a lawyer on retainer.",
  },
];

const FEATURES = [
  {
    title: "Shows its work",
    body: "Every important claim ends in [1], [2]. Each one is a card with the act, the section, the quoted passage, and a link.",
  },
  {
    title: "Plain sentences, not legalese",
    body: "You ask the way you speak. The answer comes back in simple sentences you don't need a dictionary for, with the exact section attached for proof.",
  },
  {
    title: "Admits what it doesn't know",
    body: "If no section covers your question, it says so plainly. A missing answer beats a made-up one.",
  },
  {
    title: "Ignores dead law",
    body: "Repealed provisions stay out of your answers, so you're never quoted something that no longer applies.",
  },
];

const TIERS = [
  {
    name: "Citizen",
    price: "Free",
    per: "for everyone",
    blurb: "For everyday run-ins with the rules: rent, traffic, paperwork.",
    cta: "Start chatting",
    href: "/chat",
    soon: false,
    points: ["50 questions a day", "Full section citations", "Your language, plain answers"],
  },
  {
    name: "Researcher",
    price: "৳500",
    per: "per month",
    blurb: "For students, journalists, and chamber juniors who live in the books.",
    cta: "Coming soon",
    href: "/chat",
    soon: true,
    points: ["Unlimited questions", "Filter by act & year", "Copy-ready citations"],
  },
  {
    name: "Institution",
    price: "Custom",
    per: "annual",
    blurb: "For firms, NGOs, and newsrooms with serious volume.",
    cta: "Coming soon",
    href: "/chat",
    soon: true,
    points: ["API access", "Whole-corpus search", "Priority indexing"],
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-ink">
      <SiteHeader />

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-4 pt-14 pb-10 sm:px-6 sm:pt-20">
        <div className="grid items-center gap-10 md:grid-cols-[1.1fr_0.9fr]">
          <div className="motion-safe:animate-[rise_0.7s_ease-out_both]">
            <p className="inline-flex items-center gap-2 rounded-full border border-stone-800 bg-stone-900/60 px-3 py-1 text-xs text-stone-400">
              <span className="inline-block size-1.5 rounded-full bg-gold" />
              Built on the actual statute books
            </p>
            <h1 className="mt-5 font-display text-4xl leading-[1.1] text-stone-50 sm:text-5xl">
              Know what the law <span className="text-gold">actually says</span>.
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-stone-400">
              Ask in the language you think in. Get complex laws back in plain, simple
              sentences, each pointing to the exact section behind it.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/chat"
                className="rounded-md bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.97]"
              >
                Ask a question
              </Link>
              <Link
                href="#how"
                className="rounded-md border border-stone-700 px-5 py-2.5 text-sm font-medium text-stone-200 transition-colors hover:border-stone-500 hover:text-stone-100"
              >
                See how it works
              </Link>
            </div>
          </div>

          {/* Example answer card */}
          <div
            aria-label="Example cited answer"
            className="rounded-xl border border-stone-800 bg-stone-900/50 p-5 motion-safe:animate-[drift_7s_ease-in-out_infinite] motion-safe:[animation-delay:0.7s]"
          >
            <p className="text-xs font-semibold tracking-wider text-stone-500 uppercase">Example</p>
            <p className="mt-2 rounded-lg bg-gold px-3.5 py-2.5 text-sm text-ink">
              খুনের শাস্তি কী?
            </p>
            <p className="mt-3 rounded-lg border border-stone-800 bg-ink px-3.5 py-2.5 text-sm leading-relaxed text-stone-300">
              The Penal Code answers this in a single section. <span className="font-semibold text-gold">[1]</span>
            </p>
            <div className="mt-2 rounded-lg border border-stone-800 bg-ink p-3">
              <p className="text-xs font-semibold text-stone-200">
                [1] Section 302: Punishment for murder
              </p>
              <p className="mt-0.5 text-xs text-stone-500">The Penal Code, 1860 (XLV of 1860)</p>
              <p className="mt-1.5 border-l-2 border-gold/60 pl-2 text-xs leading-relaxed text-stone-400">
                “…shall be punished with death, or imprisonment for life…”
              </p>
            </div>
          </div>
        </div>

        {/* Who it's for */}
        <div className="mt-12 border-t border-stone-800/80 pt-6">
          <p className="text-xs font-semibold tracking-wider text-stone-500 uppercase">
            Made for real headaches
          </p>
          <dl className="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {WHO.map((w) => (
              <div key={w.title}>
                <dt className="font-medium text-stone-100">{w.title}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-stone-400">{w.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-12 sm:px-6">
        <h2 className="font-display text-2xl text-stone-50 sm:text-3xl">
          An answer you can check
        </h2>
        <ol className="mt-6 divide-y divide-stone-800/80 border-y border-stone-800/80">
          {STEPS.map((s) => (
            <li key={s.n} className="grid gap-1 py-5 sm:grid-cols-[64px_220px_1fr] sm:gap-6">
              <span className="font-display text-lg text-gold">{s.n}</span>
              <span className="font-medium text-stone-100">{s.title}</span>
              <span className="text-sm leading-relaxed text-stone-400">{s.body}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-12 sm:px-6">
        <h2 className="font-display text-2xl text-stone-50 sm:text-3xl">Why people trust it</h2>
        <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-stone-800/80 bg-stone-800/80 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-ink p-6">
              <h3 className="font-medium text-stone-100">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-12 sm:px-6">
        <h2 className="font-display text-2xl text-stone-50 sm:text-3xl">Pricing</h2>
        <p className="mt-2 text-sm text-stone-400">Start free. Pay only when research becomes work.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`flex flex-col rounded-xl border p-6 ${
                t.name === "Researcher"
                  ? "border-gold/70 bg-stone-900/60"
                  : "border-stone-800/80 bg-ink"
              }`}
            >
              <h3 className="text-sm font-semibold tracking-wider text-stone-300 uppercase">{t.name}</h3>
              <p className="mt-2">
                <span className="font-display text-3xl text-stone-50">{t.price}</span>{" "}
                <span className="text-xs text-stone-500">{t.per}</span>
              </p>
              <p className="mt-2 text-sm text-stone-400">{t.blurb}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-stone-300">
                {t.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span aria-hidden className="text-gold">✓</span> {p}
                  </li>
                ))}
              </ul>
              {t.soon ? (
                <span className="mt-5 cursor-default rounded-md border border-stone-700 px-4 py-2 text-center text-sm text-stone-500">
                  {t.cta}
                </span>
              ) : (
                <Link
                  href={t.href}
                  className="mt-5 rounded-md bg-gold px-4 py-2 text-center text-sm font-semibold text-ink transition-colors hover:bg-gold-light"
                >
                  {t.cta}
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-12 sm:px-6">
        <h2 className="font-display text-2xl text-stone-50 sm:text-3xl">Questions, answered</h2>
        <div className="mt-6">
          <Faq />
        </div>
        <div className="mt-10 rounded-xl border border-gold/40 bg-stone-900/40 p-6 text-center">
          <Logo size={44} />
          <p className="mt-3 font-display text-xl text-stone-50">Stop guessing. Start citing.</p>
          <Link
            href="/chat"
            className="mt-4 inline-block rounded-md bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.97]"
          >
            Try it free
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
