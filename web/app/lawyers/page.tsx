"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SiteHeader from "@/components/site-header";
import { LANGUAGES, PRACTICE_AREAS } from "@/lib/lawyers";

type Suggestion = {
  user_id: string;
  display_name: string | null;
  practice_areas: string[];
  languages: string[];
  city: string | null;
  bio: string | null;
  bar_association: string | null;
  rating_avg: number;
  rating_count: number;
  score: number;
  reason: string;
};

type Entry = Omit<Suggestion, "score" | "reason">;

const inputCls =
  "w-full rounded-md border border-stone-700 bg-stone-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none";

function Stars({ avg, count }: { avg: number; count: number }) {
  if (!count) return <span className="text-xs text-stone-500">New, no ratings yet</span>;
  return (
    <span className="text-xs text-stone-300">
      <span className="text-gold">{"★".repeat(Math.round(avg))}</span>
      <span className="text-stone-600">{"★".repeat(5 - Math.round(avg))}</span>{" "}
      {avg.toFixed(1)} · {count} {count === 1 ? "review" : "reviews"}
    </span>
  );
}

function RateForm({ userId, signedIn, onDone }: { userId: string; signedIn: boolean; onDone: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!open) {
    return (
      <button
        onClick={() => (signedIn ? setOpen(true) : router.push("/login"))}
        className="text-xs text-gold-light hover:underline"
      >
        {signedIn ? "Rate this lawyer" : "Sign in to rate"}
      </button>
    );
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/lawyers/${userId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment: comment.trim() || null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(typeof data?.detail === "string" ? data.detail : "Could not save the review.");
        return;
      }
      setOpen(false);
      setComment("");
      setMsg(null);
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-md border border-stone-800 p-3">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            aria-label={`${n} star${n === 1 ? "" : "s"}`}
            className={`text-lg leading-none ${n <= rating ? "text-gold" : "text-stone-600"}`}
          >
            ★
          </button>
        ))}
      </div>
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="What did they help with? (optional)"
        maxLength={500}
        className={inputCls}
      />
      {msg ? <p className="text-xs text-red-300">{msg}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-gold px-3 py-1.5 text-xs font-semibold text-ink hover:bg-gold-light disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save review"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 py-1.5 text-xs text-stone-400 hover:text-stone-200">
          Cancel
        </button>
      </div>
    </form>
  );
}

function LawyerCard({ l, reason, signedIn, onRated }: { l: Entry | Suggestion; reason?: string; signedIn: boolean; onRated: () => void }) {
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-lg text-stone-50">{l.display_name ?? "Advocate"}</h3>
        <Stars avg={l.rating_avg} count={l.rating_count} />
      </div>
      {reason ? <p className="mt-2 text-sm leading-relaxed text-gold-light/90">{reason}</p> : null}
      {l.bio ? <p className="mt-2 text-sm leading-relaxed text-stone-300">{l.bio}</p> : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {l.practice_areas.map((a) => (
          <span key={a} className="rounded-full border border-stone-700 px-2 py-0.5 text-xs capitalize text-stone-300">
            {a}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-stone-500">
        {[l.bar_association, l.city, l.languages.join(" · ")].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-3">
        <RateForm userId={l.user_id} signedIn={signedIn} onDone={onRated} />
      </div>
    </div>
  );
}

function MyPractice({ onSaved }: { onSaved: () => void }) {
  const [areas, setAreas] = useState<string[]>([]);
  const [langs, setLangs] = useState<string[]>(["english"]);
  const [city, setCity] = useState("");
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/lawyer/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setAreas(d.practiceAreas ?? []);
        setLangs(d.languages?.length ? d.languages : ["english"]);
        setCity(d.city ?? "");
        setBio(d.bio ?? "");
      })
      .catch(() => {});
  }, []);

  function toggle(list: string[], v: string, set: (x: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v].slice(0, 4));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/lawyer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practiceAreas: areas, languages: langs, city: city.trim() || null, bio: bio.trim() || null }),
      });
      setMsg(res.ok ? "Saved. Your profile is now matchable." : "Could not save. Try again.");
      if (res.ok) onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-stone-800 bg-stone-900/40 p-5">
      <h2 className="font-display text-lg text-stone-50">My practice</h2>
      <p className="mt-1 text-sm text-stone-400">What clients match you on. Keep it to your real strengths.</p>
      <p className="mt-4 text-xs font-medium text-stone-400">Practice areas (up to 4)</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PRACTICE_AREAS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => toggle(areas, a, setAreas)}
            className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
              areas.includes(a) ? "border-gold bg-gold/15 text-stone-100" : "border-stone-700 text-stone-400 hover:border-stone-500"
            }`}
          >
            {a}
          </button>
        ))}
      </div>
      <p className="mt-4 text-xs font-medium text-stone-400">Languages</p>
      <div className="mt-2 flex gap-1.5">
        {LANGUAGES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => toggle(langs, l, setLangs)}
            className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
              langs.includes(l) ? "border-gold bg-gold/15 text-stone-100" : "border-stone-700 text-stone-400 hover:border-stone-500"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City, e.g. Dhaka" maxLength={80} className={inputCls} />
        <input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="One line about your work" maxLength={1000} className={inputCls} />
      </div>
      {msg ? <p className="mt-2 text-xs text-stone-300">{msg}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink hover:bg-gold-light disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save practice profile"}
      </button>
    </form>
  );
}

/** Suggested lawyers from your history, plus the browsable directory.
 * Lawyers see their own practice editor on the same page. */
export default function LawyersPage() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const [isLawyer, setIsLawyer] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [need, setNeed] = useState<{ dominant?: string; summary?: string } | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [directory, setDirectory] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadDirectory() {
    const r = await fetch("/api/lawyers").then((x) => (x.ok ? x.json() : null));
    if (r) setDirectory(r.items ?? []);
  }

  useEffect(() => {
    let live = true;
    fetch("/api/billing/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        setSignedIn(true);
        setIsLawyer(d.role === "lawyer");
      })
      .catch(() => {});
    fetch("/api/lawyers")
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => {
        if (live && r) setDirectory(r.items ?? []);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  /** Re-pull suggestions; silent when refreshing after a rating. */
  async function fetchSuggestions(silent = false) {
    if (!silent) {
      if (busy) return;
      setBusy(true);
    }
    try {
      const r = await fetch("/api/lawyers/recommend", { method: "POST" });
      const d = r.ok ? await r.json() : null;
      if (d) {
        setSuggestions(d.results ?? []);
        setNeed(d.need ?? null);
        setFallback(d.fallback ?? null);
      }
    } finally {
      if (!silent) setBusy(false);
    }
  }

  function suggest() {
    void fetchSuggestions();
  }

  function refreshAfterRating() {
    void loadDirectory();
    void fetchSuggestions(true);
  }

  return (
    <div className="min-h-screen bg-ink">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-xs font-semibold tracking-widest text-gold-light uppercase">Find a lawyer</p>
        <h1 className="mt-2 font-display text-3xl text-stone-50">Matched to your matter, not ads</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-400">
          Suggestions come from your recent questions and documents, ranked by practice fit, matter
          similarity, and client ratings. Only verified advocates appear.
        </p>

        {isLawyer ? (
          <div className="mt-6">
            <MyPractice onSaved={loadDirectory} />
          </div>
        ) : null}

        <div className="mt-8 flex items-center justify-between">
          <h2 className="font-display text-lg text-stone-50">Suggested for you</h2>
          {signedIn ? (
            <button
              onClick={suggest}
              disabled={busy}
              className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink hover:bg-gold-light disabled:opacity-60"
            >
              {busy ? "Reading your history…" : suggestions ? "Refresh suggestions" : "Suggest from my history"}
            </button>
          ) : (
            <Link href="/login" className="text-sm text-gold-light hover:underline">
              Sign in for personal suggestions
            </Link>
          )}
        </div>
        {suggestions === null ? (
          <p className="mt-3 text-sm text-stone-500">
            {signedIn
              ? "Ask a few legal questions first, then request suggestions."
              : "Browse the directory below, or sign in for personal suggestions."}
          </p>
        ) : suggestions.length === 0 ? (
          <p className="mt-3 rounded-lg border border-stone-800 px-4 py-6 text-center text-sm text-stone-400">
            {fallback === "directory"
              ? "No verified match for your matter yet. Browse the directory below instead."
              : "Nothing to suggest right now."}
          </p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {need?.summary ? <p className="text-sm text-stone-500 md:col-span-2">Read as: {need.summary}</p> : null}
            {suggestions.map((s) => (
              <LawyerCard key={s.user_id} l={s} reason={s.reason} signedIn={signedIn} onRated={refreshAfterRating} />
            ))}
          </div>
        )}

        <h2 className="mt-10 font-display text-lg text-stone-50">Directory</h2>
        {directory.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No verified lawyers listed yet.</p>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {directory.map((d) => (
              <LawyerCard key={d.user_id} l={d} signedIn={signedIn} onRated={loadDirectory} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
