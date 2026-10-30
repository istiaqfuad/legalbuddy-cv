import Link from "next/link";
import AuthButton from "./auth-button";
import Logo from "./logo";
import OpenAppLink from "./open-app-link";
import ThemeToggle from "./theme-toggle";

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Why trust it" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-stone-800/80 bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={32} />
          <span className="font-display text-lg text-stone-100">LegalBuddy</span>
        </Link>
        <nav className="ml-auto hidden items-center gap-6 text-sm text-stone-400 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="transition-colors hover:text-stone-100">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 md:ml-6 md:gap-2">
          <OpenAppLink />
          <ThemeToggle />
          <AuthButton />
        </div>
      </div>
    </header>
  );
}
