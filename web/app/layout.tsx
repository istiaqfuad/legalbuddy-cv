import type { Metadata } from "next";
import Script from "next/script";
import Providers from "@/components/providers";
import "./globals.css";

export const viewport = {
  themeColor: "#171310",
};

export const metadata: Metadata = {
  title: "LegalBuddy: Know what the law actually says",
  description:
    "Ask questions about Bangladeshi law in your own words. Get plain answers where every claim cites the exact statute section behind it.",
};

/** Applies the saved theme before first paint so the page never flashes. */
const THEME_BOOT = `(function(){try{var t=localStorage.getItem("lb-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-ink text-stone-200 antialiased">
        <Script id="lb-theme-boot" strategy="beforeInteractive">
          {THEME_BOOT}
        </Script>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
