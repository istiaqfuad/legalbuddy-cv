"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";

/** Account control: avatar (photo or person glyph) opening a menu with
 * settings and sign-out. No name in the bar.
 */
export default function AuthButton() {
  const { data: session, status, update } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLawyer, setIsLawyer] = useState(false);
  const [openRequests, setOpenRequests] = useState(0);
  const [failedPhotoUrl, setFailedPhotoUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const photoUrl = session?.user?.image || "";
  const showPhoto = photoUrl !== "" && failedPhotoUrl !== photoUrl;

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setEditing(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setEditing(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);



  if (status === "loading") {
    return <span className="size-8 rounded-full bg-stone-800 motion-safe:animate-pulse" />;
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

  const label = session.user.name ?? session.user.email ?? "Account";

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const next = name.trim();
    if (!next || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) throw new Error("save failed");
      await update({ name: next });
      setEditing(false);
      setMenuOpen(false);
    } catch {
      setSaveError("Could not save your name. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => {
          if (!menuOpen) {
            setName(session?.user?.name ?? "");
            fetch("/api/billing/status")
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => {
                setIsAdmin(d?.role === "admin");
                const lawyer = d?.role === "lawyer" && d?.lawyerStatus === "verified";
                setIsLawyer(lawyer);
                if (lawyer) {
                  fetch("/api/lawyer/handoffs")
                    .then((r) => (r.ok ? r.json() : null))
                    .then((h) =>
                      setOpenRequests(
                        Array.isArray(h?.handoffs) ? h.handoffs.filter((x: { status: string }) => x.status === "open").length : 0,
                      ),
                    )
                    .catch(() => {});
                }
              })
              .catch(() => {});
          }
          setMenuOpen((o) => !o);
          setEditing(false);
        }}
        className="flex size-8 items-center justify-center overflow-hidden rounded-full hover:ring-2 hover:ring-gold/60 focus:ring-2 focus:ring-gold/60 focus:outline-none"
        title={label}
        aria-label="Account menu"
        aria-expanded={menuOpen}
      >
        {showPhoto ? (
          <span className="flex size-8 items-center justify-center overflow-hidden rounded-full bg-stone-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt=""
              className="size-8 rounded-full object-cover"
              onError={() => setFailedPhotoUrl(photoUrl)}
            />
          </span>
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-stone-700 ring-1 ring-stone-600 ring-inset">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-200" aria-hidden="true">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </span>
        )}
      </button>
      {menuOpen ? (
        <div className="absolute top-10 right-0 z-40 w-64 rounded-lg border border-stone-700/80 bg-stone-950 p-2 shadow-xl shadow-black/50">
          <p className="truncate px-2 pt-1 text-xs text-stone-500">{session.user.email}</p>
          {editing ? (
            <form onSubmit={saveName} className="mt-2 space-y-2 px-1 pb-1">
              <label htmlFor="display-name" className="px-1 text-xs font-medium text-stone-400">
                Display name
              </label>
              <input
                id="display-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                autoFocus
                className="w-full rounded-md border border-stone-700 bg-stone-900/60 px-2.5 py-1.5 text-sm text-stone-100 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none"
              />
              {saveError ? <p className="px-1 text-xs text-red-300">{saveError}</p> : null}
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!name.trim() || saving}
                  className="flex-1 rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-300 transition-colors hover:border-stone-500"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              {session.user.name ? (
                <p className="truncate px-2 pt-0.5 text-sm font-medium text-stone-200">
                  {session.user.name}
                </p>
              ) : null}
              <button
                onClick={() => setEditing(true)}
                className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-stone-300 transition-colors hover:bg-stone-800/70 hover:text-stone-100"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
                Change display name
              </button>
              <Link
                href="/pricing"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-stone-300 transition-colors hover:bg-stone-800/70 hover:text-stone-100"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2v20" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                Plan and billing
              </Link>
              {isAdmin ? (
                <Link
                  href="/admin"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-stone-300 transition-colors hover:bg-stone-800/70 hover:text-stone-100"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
                    <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
                    <path d="M12 2v2" />
                    <path d="M12 20v2" />
                    <path d="m4.9 4.9 1.4 1.4" />
                    <path d="m17.7 17.7 1.4 1.4" />
                    <path d="M2 12h2" />
                    <path d="M20 12h2" />
                    <path d="m6.3 17.7-1.4 1.4" />
                    <path d="m19.1 4.9-1.4 1.4" />
                  </svg>
                  Administration
                </Link>
              ) : null}
              {isLawyer ? (
                <Link
                  href="/lawyer/requests"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-stone-300 transition-colors hover:bg-stone-800/70 hover:text-stone-100"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
                  </svg>
                  Business requests
                  {openRequests > 0 ? (
                    <span className="ml-auto rounded-full bg-gold px-2 py-0.5 text-[11px] font-semibold text-ink">
                      {openRequests}
                    </span>
                  ) : null}
                </Link>
              ) : null}
              <Link
                href="/verify-lawyer"
                onClick={() => setMenuOpen(false)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-stone-300 transition-colors hover:bg-stone-800/70 hover:text-stone-100"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <path d="m10 17 5-5-5-5" />
                  <path d="M15 12H3" />
                </svg>
                Lawyer verification
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-stone-300 transition-colors hover:bg-stone-800/70 hover:text-stone-100"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="m16 17 5-5-5-5" />
                  <path d="M21 12H9" />
                </svg>
                Sign out
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
