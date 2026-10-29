import Link from "next/link";
import Logo from "./logo";

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Why cited" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-stone-800/80 bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={32} badge />
          <span className="font-display text-lg text-stone-100">LegalBuddy</span>
        </Link>
        <nav className="ml-auto hidden items-center gap-6 text-sm text-stone-400 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="transition-colors hover:text-stone-100">
              {n.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/chat"
          className="ml-auto rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-gold-light md:ml-6"
        >
          Open app
        </Link>
      </div>
    </header>
  );
}
