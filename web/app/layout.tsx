import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LegalBuddy — Know what the law actually says",
  description:
    "Ask questions about Bangladeshi law in English, Bangla, or both. Every answer cites the exact statute sections it relies on.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-ink text-stone-200 antialiased">{children}</body>
    </html>
  );
}
