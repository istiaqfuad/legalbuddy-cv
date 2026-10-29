import Link from "next/link";
import Logo from "./logo";

export default function SiteFooter() {
  return (
    <footer className="border-t border-stone-800/80">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 text-sm text-stone-500 sm:flex-row sm:items-center sm:px-6">
        <span className="flex items-center gap-2">
          <Logo size={22} badge />
          <span className="font-display text-stone-300">LegalBuddy</span>
        </span>
        <p className="sm:ml-2">
          Research assistance only, not a substitute for a lawyer. Always verify against the
          linked act.
        </p>
        <Link href="/chat" className="transition-colors hover:text-gold sm:ml-auto">
          Start chatting
        </Link>
      </div>
    </footer>
  );
}
