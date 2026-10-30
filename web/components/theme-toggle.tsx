"use client";

/** Sun/moon switch between the warm espresso and warm paper themes.
 * Persists to localStorage; the layout's inline script applies it
 * before first paint so there is no flash.
 *
 * Both icons always render and CSS picks the visible one. That keeps
 * server and client markup byte-identical, so persisted themes can
 * never cause a hydration mismatch.
 */
export default function ThemeToggle() {
  function flip() {
    const next =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("lb-theme", next);
    } catch {
      // Private mode: the theme just won't persist.
    }
  }

  return (
    <button
      onClick={flip}
      className="rounded-md p-2 text-stone-400 transition-colors hover:bg-stone-800/60 hover:text-stone-100"
      title="Switch theme"
      aria-label="Switch theme"
    >
      <svg className="theme-icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg className="theme-icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
    </button>
  );
}
