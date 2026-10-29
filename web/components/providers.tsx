"use client";

import { SessionProvider } from "next-auth/react";

/** Client session context for the whole app. */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
