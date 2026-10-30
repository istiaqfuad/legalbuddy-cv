"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** "Open app" call to action, hidden once the user is already in the app. */
export default function OpenAppLink() {
  const pathname = usePathname();
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return null;
  return (
    <Link
      href="/chat"
      className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.97]"
    >
      Open app
    </Link>
  );
}
