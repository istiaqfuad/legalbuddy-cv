"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Logo from "@/components/logo";
import SiteHeader from "@/components/site-header";

const inputCls =
  "w-full rounded-md border border-stone-700 bg-stone-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none";

/** Lawyer verification: enrollment details plus a Sanad scan. A name and
 * number match against the scan verifies instantly; anything unclear
 * waits for a human reviewer. */
export default function VerifyLawyerPage() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [existing, setExisting] = useState<{ status: string; note: string | null } | null>(null);
  const [fullName, setFullName] = useState("");
  const [sanadNo, setSanadNo] = useState("");
  const [enrollmentDate, setEnrollmentDate] = useState("");
  const [bar, setBar] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/lawyer/verify")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        setSignedIn(true);
        if (d.review) setExisting({ status: d.review.status, note: d.review.note });
      })
      .catch(() => {});
    fetch("/api/billing/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(() => {
        if (live) setLoading(false);
      })
      .catch(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !file) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const form = new FormData();
      form.append("fullName", fullName);
      form.append("sanadNo", sanadNo);
      form.append("barAssociation", bar);
      form.append("enrollmentDate", enrollmentDate);
      form.append("sanad", file);
      const res = await fetch("/api/lawyer/verify", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof data?.detail === "string" ? data.detail : "Submission failed. Please try again.");
        return;
      }
      setDone("Received. A reviewer checks the Sanad against the Bar Council roll, and your account unlocks as soon as it clears.");
      setExisting({ status: "pending", note: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <Logo size={44} />
            <h1 className="font-display text-2xl text-stone-100">Lawyer verification</h1>
            <p className="text-sm leading-relaxed text-stone-400">
              Only enrolled advocates of the Bangladesh Bar Council practice here as lawyers.
              Your Sanad stays private and is used only for this check.
            </p>
          </div>
          <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-5">
            {loading ? (
              <p className="text-sm text-stone-500">Loading…</p>
            ) : !signedIn ? (
              <p className="text-sm leading-relaxed text-stone-300">
                <Link href="/login" className="font-medium text-gold-light hover:underline">
                  Sign in
                </Link>{" "}
                first, then verify your enrollment.
              </p>
            ) : existing?.status === "verified" ? (
              <div className="text-sm leading-relaxed text-stone-200">
                <p className="font-semibold text-emerald-300">Verified advocate.</p>
                <p className="mt-1 text-stone-400">
                  Research Mode treats you as counsel. Keep your Sanad details current if they change.
                </p>
                <Link
                  href="/chat"
                  className="mt-4 block rounded-md bg-gold px-4 py-2 text-center text-sm font-semibold text-ink transition-colors hover:bg-gold-light"
                >
                  Back to chat
                </Link>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                {existing?.status === "pending" ? (
                  <p className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs leading-relaxed text-stone-300">
                    A submission is already under review. Resubmitting replaces it.
                  </p>
                ) : existing?.status === "rejected" ? (
                  <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs leading-relaxed text-red-200">
                    The last submission did not clear{existing.note ? `: ${existing.note}` : "."} Check the
                    details and try again.
                  </p>
                ) : null}
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Full name as printed on the Sanad"
                  autoComplete="name"
                  required
                  className={inputCls}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    value={sanadNo}
                    onChange={(e) => setSanadNo(e.target.value)}
                    placeholder="Sanad / enrollment no."
                    required
                    className={inputCls}
                  />
                  <input
                    value={enrollmentDate}
                    onChange={(e) => setEnrollmentDate(e.target.value)}
                    type="date"
                    aria-label="Date of enrollment"
                    className={inputCls}
                  />
                </div>
                <input
                  value={bar}
                  onChange={(e) => setBar(e.target.value)}
                  placeholder="Bar association, e.g. Dhaka Bar Association"
                  required
                  className={inputCls}
                />
                <label className="block rounded-md border border-dashed border-stone-700 px-3 py-3 text-sm text-stone-400 transition-colors hover:border-stone-500">
                  {file ? file.name : "Attach a photo or PDF of the Sanad (up to 10 MB)"}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    required={!existing}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="sr-only"
                  />
                </label>
                {error ? <p className="text-xs leading-relaxed text-red-300">{error}</p> : null}
                {done ? <p className="text-xs leading-relaxed text-emerald-300">{done}</p> : null}
                <button
                  type="submit"
                  disabled={busy || (!file && !existing)}
                  className="w-full rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-all hover:bg-gold-light active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? "Submitting…" : "Submit for verification"}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
