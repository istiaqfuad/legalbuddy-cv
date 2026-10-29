import Link from "next/link";
import Faq from "@/components/faq";
import Logo from "@/components/logo";
import SiteFooter from "@/components/site-footer";
import SiteHeader from "@/components/site-header";

async function getIndexStatus(): Promise<{ points: number | null; live: boolean }> {
  const base = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${base}/health`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { points: null, live: false };
    const data = await res.json();
    return {
      points: typeof data.points === "number" ? data.points : null,
      live: data.status === "ok",
    };
  } catch {
    return { points: null, live: false };
  }
}

const STEPS = [
  {
    n: "01",
    title: "Ask like you think",
    body: "Type a plain question — English, Bangla, or mixed mid-sentence. No keywords, no section numbers, no language toggle.",
  },
  {
    n: "02",
    title: "Sections are retrieved",
    body: "Hybrid dense + sparse search scans every ingested provision and ranks the exact sections that answer you.",
  },
  {
    n: "03",
    title: "Answer with receipts",
    body: "A grounded reply where each claim ends in [1], [2] — each tied to a card quoting the section and linking the act.",
  },
];

const FEATURES = [
  {
    title: "Section-level citations",
    body: "Act title and year, section number and heading, the relied-on excerpt, and a link to the full act — on every cited section.",
  },
  {
    title: "Truly bilingual",
    body: "Ask in Bangla, get an answer grounded in an English act — or the reverse. Cross-language retrieval is the default, not a mode.",
  },
  {
    title: "Honest when unsure",
    body: "If no retrieved section supports an answer, LegalBuddy says so plainly instead of inventing law. Silence beats hallucination.",
  },
  {
    title: "Repeal-aware index",
    body: "Repealed provisions are filtered out of retrieval, so dead law never masquerades as current advice.",
  },
];

const TIERS = [
  {
    name: "Citizen",
    price: "Free",
    per: "for everyone",
    blurb: "Look up the law that governs your everyday life.",
    cta: "Start chatting",
    href: "/chat",
    soon: false,
    points: ["50 questions a day", "Full section citations", "English, Bangla & mixed"],
  },
  {
    name: "Researcher",
    price: "৳500",
    per: "per month",
    blurb: "For students, journalists, and chamber juniors.",
    cta: "Coming soon",
    href: "/chat",
    soon: true,
    points: ["Unlimited questions", "Filter by act & year", "Copy-ready citations"],
  },
  {
    name: "Institution",
    price: "Custom",
    per: "annual",
    blurb: "For firms, NGOs, and newsrooms with heavy use.",
    cta: "Coming soon",
    href: "/chat",
    soon: true,
    points: ["API access", "Whole-corpus search", "Priority indexing"],
  },
];

export default async function Landing() {
  const { points, live } = await getIndexStatus();

  return (
    <div className="min-h-screen bg-ink">
      <SiteHeader />

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-4 pt-14 pb-10 sm:px-6 sm:pt-20">
        <div className="grid items-center gap-10 md:grid-cols-[1.1fr_0.9fr]">
          <div className="motion-safe:animate-[rise_0.7s_ease-out_both]">
            <p className="inline-flex items-center gap-2 rounded-full border border-stone-800 bg-stone-900/60 px-3 py-1 text-xs text-stone-400">
              <span
                className={`inline-block size-1.5 rounded-full ${
                  live ? "bg-emerald-400 motion-safe:animate-pulse" : "bg-stone-500"
                }`}
              />
              {live && points !== null
                ? `${points.toLocaleString()} sections indexed and counting`
                : "Index warming up"}
            </p>
            <h1 className="mt-5 font-display text-4xl leading-[1.1] text-stone-50 sm:text-5xl">
              Know what the law <span className="text-gold">actually says</span>.
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-stone-400">
              Ask about Bangladeshi law in your own words. LegalBuddy finds the exact statute
              sections and answers with citations you can check — never vibes.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/chat"
                className="rounded-md bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-gold-light"
              >
                Ask a question
              </Link>
              <Link
                href="#how"
                className="rounded-md border border-stone-700 px-5 py-2.5 text-sm font-medium text-stone-200 transition-colors hover:border-stone-500 hover:text-white"
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
              Which law lets the government create new districts?
            </p>
            <p className="mt-3 rounded-lg border border-stone-800 bg-ink px-3.5 py-2.5 text-sm leading-relaxed text-stone-300">
              The government may divide the country into districts… <span className="font-semibold text-gold">[1]</span>
            </p>
            <div className="mt-2 rounded-lg border border-stone-800 bg-ink p-3">
              <p className="text-xs font-semibold text-stone-200">
                [1] Section 3 — Formation of districts
              </p>
              <p className="mt-0.5 text-xs text-stone-500">The Districts Act (No. II of 1836)</p>
              <p className="mt-1.5 border-l-2 border-gold/60 pl-2 text-xs leading-relaxed text-stone-400">
                “…it shall be lawful for the Government to divide…”
              </p>
            </div>
          </div>
        </div>

        <dl className="mt-12 grid grid-cols-3 gap-4 border-t border-stone-800/80 pt-6">
          {[
            ["1,484", "acts of Parliament indexed"],
            ["EN + বাংলা", "ask in either, or both at once"],
            ["100%", "of claims backed by a citation"],
          ].map(([v, l]) => (
            <div key={l}>
              <dt className="sr-only">{l}</dt>
              <dd className="font-display text-2xl text-stone-100 sm:text-3xl">{v}</dd>
              <dd className="mt-1 text-xs text-stone-500 sm:text-sm">{l}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-5xl scroll-mt-20 px-4 py-12 sm:px-6">
        <h2 className="font-display text-2xl text-stone-50 sm:text-3xl">From question to proof</h2>
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
        <h2 className="font-display text-2xl text-stone-50 sm:text-3xl">Why cited answers win</h2>
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
          <Logo size={44} badge />
          <p className="mt-3 font-display text-xl text-stone-50">Stop guessing. Start citing.</p>
          <Link
            href="/chat"
            className="mt-4 inline-block rounded-md bg-gold px-5 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-gold-light"
          >
            Try it free
          </Link>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
