"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Stats = {
  users: number;
  signupsToday: number;
  pendingReviews: number;
  conversations: number;
  messages: number;
  byPlan: Record<string, number>;
  byRole: Record<string, number>;
  byLawyerStatus: Record<string, number>;
} | null;

type Review = {
  user_id: string;
  full_name: string;
  sanad_no: string;
  enrollment_date: string | null;
  bar_association: string;
  status: string;
  reviewer_note: string | null;
  updated_at: string;
  email: string;
  sanadUrl: string;
};

const th = "px-3 py-2 text-left text-xs font-medium text-stone-500";
const td = "px-3 py-2 text-sm text-stone-200";

/** One dashboard refresh: headline counts plus the filtered queue. */
async function fetchDashboard(filter: string) {
  const [stats, queue] = await Promise.all([
    fetch("/api/admin/stats").then((x) => (x.ok ? x.json() : null)),
    fetch(`/api/admin/verifications?status=${filter}`).then((x) => (x.ok ? x.json() : null)),
  ]);
  return { stats, reviews: (queue?.items ?? []) as Review[] };
}

/** Internal operations view: headline counts, the enrollment review
 * queue, and the people table. Plain ledger styling, no marketing. */
export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [filter, setFilter] = useState("pending");
  const [selected, setSelected] = useState<Review | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Re-pull counts and queue (event handler: free to set state). */
  const refresh = useCallback(async () => {
    const { stats: s, reviews } = await fetchDashboard(filter);
    if (s) setStats(s);
    setReviews(reviews);
    setSelected((cur) => (cur ? (reviews.find((i) => i.user_id === cur.user_id) ?? null) : null));
  }, [filter]);

  useEffect(() => {
    let live = true;
    fetchDashboard(filter).then(({ stats: s, reviews }) => {
      if (!live) return;
      if (s) setStats(s);
      setReviews(reviews);
      setSelected((cur) =>
        cur ? (reviews.find((i) => i.user_id === cur.user_id) ?? null) : null,
      );
    });
    return () => {
      live = false;
    };
  }, [filter]);

  function pick(review: Review) {
    setSelected(review);
    setNote(review.reviewer_note ?? "");
  }

  async function decide(decision: "verified" | "rejected") {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/lawyer/verify", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selected.user_id, decision, note: note.trim() || null }),
      });
      if (!res.ok) {
        setError("The decision did not save. Try again.");
        return;
      }
      setSelected(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const counts: Array<[string, number | undefined]> = stats
    ? [
        ["People", stats.users],
        ["Signed up today", stats.signupsToday],
        ["Reviews waiting", stats.pendingReviews],
        ["Conversations", stats.conversations],
        ["Answers stored", stats.messages],
        ["Professional plans", stats.byPlan.professional],
        ["Business plans", stats.byPlan.business],
        ["Verified lawyers", stats.byLawyerStatus.verified],
      ]
    : [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-stone-50">Administration</h1>
          <p className="mt-1 text-sm text-stone-400">Counts, enrollment reviews, and the people table.</p>
        </div>
        <Link href="/chat" className="text-sm text-gold-light hover:underline">
          Back to chat
        </Link>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-stone-800 bg-stone-800 sm:grid-cols-4">
        {counts.map(([label, value]) => (
          <div key={label} className="bg-ink px-4 py-4">
            <dt className="text-xs text-stone-500">{label}</dt>
            <dd className="mt-1 font-display text-2xl text-stone-50">{value ?? "–"}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-stone-50">Enrollment reviews</h2>
          <div className="flex gap-1 text-sm">
            {(["pending", "verified", "rejected"] as const).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setFilter(f);
                  setSelected(null);
                }}
                className={`rounded-md px-3 py-1 capitalize transition-colors ${
                  filter === f ? "bg-stone-800 text-stone-100" : "text-stone-500 hover:text-stone-200"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {reviews.length === 0 ? (
          <p className="mt-3 rounded-lg border border-stone-800 px-4 py-6 text-center text-sm text-stone-500">
            Nothing waiting under this filter.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-stone-800">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className={th}>Name</th>
                  <th className={th}>Sanad</th>
                  <th className={th}>Bar</th>
                  <th className={th}>Filed</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <tr
                    key={r.user_id}
                    onClick={() => pick(r)}
                    className={`cursor-pointer border-b border-stone-800/60 last:border-0 transition-colors hover:bg-stone-900/60 ${
                      selected?.user_id === r.user_id ? "bg-stone-900/60" : ""
                    }`}
                  >
                    <td className={td}>
                      <span className="block font-medium text-stone-100">{r.full_name}</span>
                      <span className="block text-xs text-stone-500">{r.email}</span>
                    </td>
                    <td className={td}>{r.sanad_no}</td>
                    <td className={td}>{r.bar_association}</td>
                    <td className={`${td} whitespace-nowrap text-stone-400`}>
                      {new Date(r.updated_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selected ? (
          <div className="mt-3 rounded-lg border border-stone-700 bg-stone-900/40 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-lg text-stone-50">{selected.full_name}</h3>
              <a
                href={selected.sanadUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-gold-light hover:underline"
              >
                Open the Sanad scan
              </a>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-stone-500">Account</dt><dd className="text-stone-200">{selected.email}</dd></div>
              <div><dt className="text-xs text-stone-500">Sanad number</dt><dd className="text-stone-200">{selected.sanad_no}</dd></div>
              <div><dt className="text-xs text-stone-500">Enrolled</dt><dd className="text-stone-200">{selected.enrollment_date ?? "Not given"}</dd></div>
              <div><dt className="text-xs text-stone-500">Bar</dt><dd className="text-stone-200">{selected.bar_association}</dd></div>
            </dl>
            {filter !== "pending" && selected.reviewer_note ? (
              <p className="mt-3 text-sm text-stone-400">Earlier note: {selected.reviewer_note}</p>
            ) : null}
            {selected.status === "pending" ? (
              <>
                <label htmlFor="review-note" className="mt-4 block text-xs font-medium text-stone-400">
                  Note for the record (shown to the lawyer on rejection)
                </label>
                <textarea
                  id="review-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className="mt-1 w-full rounded-md border border-stone-700 bg-stone-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-gold focus:outline-none"
                />
                {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => decide("verified")}
                    disabled={busy}
                    className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-gold-light disabled:opacity-60"
                  >
                    {busy ? "Saving…" : "Approve"}
                  </button>
                  <button
                    onClick={() => decide("rejected")}
                    disabled={busy}
                    className="rounded-md border border-stone-700 px-4 py-2 text-sm text-stone-200 transition-colors hover:border-stone-500 disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
