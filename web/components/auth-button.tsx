"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

/** Header auth area: sign-in link, or the account name with sign-out. */
export default function AuthButton() {
  const { data: session, status } = useSession();
  if (status === "loading") {
    return <span className="text-sm text-stone-500">…</span>;
  }
  if (!session?.user) {
    return (
      <Link
        href="/login"
        className="rounded-md border border-stone-700 px-4 py-2 text-sm font-medium text-stone-200 transition-colors hover:border-gold/60 hover:text-stone-100"
      >
        Sign in
      </Link>
    );
  }
  return (
    <span className="flex items-center gap-3">
      <span className="hidden max-w-32 truncate text-sm text-stone-400 sm:block">
        {session.user.name ?? session.user.email}
      </span>
      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        className="rounded-md border border-stone-700 px-3 py-2 text-sm text-stone-300 transition-colors hover:border-stone-500 hover:text-stone-100"
      >
        Sign out
      </button>
    </span>
  );
}
