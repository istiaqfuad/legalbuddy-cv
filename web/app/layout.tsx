import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LegalBuddy — Bangladesh Statute Assistant",
  description:
    "Ask questions about Bangladeshi law; every answer cites the exact statute sections it relies on.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
