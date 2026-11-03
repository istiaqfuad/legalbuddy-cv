"use client";

import { useCallback, useEffect, useState } from "react";

/** Business compliance dashboard: deadline tracker plus document vault.
 * Dates are owner-confirmed records with citations they can verify;
 * nothing here interprets law. Suggestions come from the vault files'
 * own stored text (rules only) and only become deadlines on approval.
 */

interface Deadline {
  id: string;
  title: string;
  category: string;
  due_date: string;
  recurrence: string;
  source_section: string;
  source_url: string;
  done: boolean;
  proof_doc_id: string | null;
  state: "overdue" | "due-soon" | "later" | "done";
  daysUntil: number;
}

interface VaultDoc {
  doc_id: string;
  filename: string;
  mime: string;
  chunks: number;
  created_at: string;
}

interface Suggestion {
  date: string;
  context: string;
}

interface Profile {
  business_name: string;
  business_type: string;
  city: string;
  turnover_band: string;
  headcount_band: string;
  regulated_goods: boolean;
  holds_customer_data: boolean;
}

const CATEGORIES = ["licence", "tax", "vat", "labour", "data", "other"];
const RECURRENCE = ["none", "monthly", "quarterly", "yearly"];
const TYPES = [
  { id: "online_seller", label: "Online seller" },
  { id: "shop", label: "Shop" },
  { id: "workshop", label: "Workshop" },
  { id: "other", label: "Other" },
];

const cardCls =
  "rounded-lg border border-stone-800 bg-stone-900/40 p-5";
const inputCls =
  "w-full rounded-md border border-stone-700 bg-stone-900/60 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:border-gold focus:ring-1 focus:ring-gold focus:outline-none";
const goldBtn =
  "rounded-md bg-gold px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-60";
const ghostBtn =
  "rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-300 transition-colors hover:border-stone-500 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-60";

function stateChip(d: Deadline) {
  if (d.state === "overdue")
    return <span className="rounded-full bg-red-950 px-2.5 py-0.5 text-xs font-medium text-red-200">Overdue</span>;
  if (d.state === "due-soon")
    return (
      <span className="rounded-full bg-gold/15 px-2.5 py-0.5 text-xs font-medium text-gold-light">
        Due in {d.daysUntil} {d.daysUntil === 1 ? "day" : "days"}
      </span>
    );
  if (d.state === "done") return <span className="rounded-full bg-stone-800 px-2.5 py-0.5 text-xs text-stone-400">Done</span>;
  return <span className="rounded-full bg-stone-800 px-2.5 py-0.5 text-xs text-stone-400">{d.due_date}</span>;
}

export default function BusinessDashboard() {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("licence");
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState("none");
  const [source, setSource] = useState("");

  const [suggestFor, setSuggestFor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [reviewFor, setReviewFor] = useState<string | null>(null);
  const [reviewFlags, setReviewFlags] = useState<Array<{ title: string; clause: string; risk: string; explanation: string; citation: { act: string; section: string } }>>([]);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [proofDoc, setProofDoc] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{
    overdue: number;
    dueSoon: number;
    open: number;
    doneLast30: number;
    vaultFiles: number;
    gaps: Array<{ kind: string; label: string }>;
    upcoming: Array<{ id: string; title: string; due_date: string; state: string; daysUntil: number }>;
  } | null>(null);

  const [pName, setPName] = useState("");
  const [pType, setPType] = useState("other");
  const [pCity, setPCity] = useState("");
  const [pTurnover, setPTurnover] = useState("unknown");
  const [pHeadcount, setPHeadcount] = useState("unknown");
  const [pRegulated, setPRegulated] = useState(false);
  const [pCustomerData, setPCustomerData] = useState(false);

  const [lawyers, setLawyers] = useState<Array<{ user_id: string; display_name: string; practice_areas: string[]; city: string | null }>>([]);
  const [handoffs, setHandoffs] = useState<Array<{ id: string; subject: string; status: string; lawyer_name: string; created: string; lawyer_note: string }>>([]);
  const [hLawyer, setHLawyer] = useState("");
  const [hSubject, setHSubject] = useState("");
  const [hDetails, setHDetails] = useState("");
  const [hDocs, setHDocs] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [dl, dc, pf, sn] = await Promise.all([
        fetch("/api/business/deadlines").then((r) => r.json()),
        fetch("/api/documents").then((r) => r.json()),
        fetch("/api/business/profile").then((r) => r.json()),
        fetch("/api/business/snapshot").then((r) => r.json()).catch(() => ({})),
      ]);
      if (sn.snapshot) setSnapshot(sn.snapshot);
      const [dir, ho] = await Promise.all([
        fetch("/api/lawyers").then((r) => r.json()).catch(() => ({})),
        fetch("/api/business/handoffs").then((r) => r.json()).catch(() => ({})),
      ]);
      if (Array.isArray(dir.items)) setLawyers(dir.items);
      if (Array.isArray(ho.handoffs)) setHandoffs(ho.handoffs);
      if (Array.isArray(dl.deadlines)) setDeadlines(dl.deadlines);
      if (Array.isArray(dc.documents)) setDocs(dc.documents);
      if (pf.profile) {
        setProfile(pf.profile);
        setPName(pf.profile.business_name ?? "");
        setPType(pf.profile.business_type ?? "other");
        setPCity(pf.profile.city ?? "");
        setPTurnover(pf.profile.turnover_band ?? "unknown");
        setPHeadcount(pf.profile.headcount_band ?? "unknown");
        setPRegulated(pf.profile.regulated_goods === true);
        setPCustomerData(pf.profile.holds_customer_data === true);
      }
    } catch {
      setError("Could not load the dashboard. Please refresh.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addDeadline(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !dueDate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/business/deadlines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          category,
          due_date: dueDate,
          recurrence,
          source_section: source.trim(),
          proof_doc_id: proofDoc,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(typeof data?.detail === "string" ? data.detail : "Could not save the deadline.");
      }
      setTitle("");
      setDueDate("");
      setSource("");
      setRecurrence("none");
      setProofDoc(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the deadline.");
    } finally {
      setBusy(false);
    }
  }

  async function setDone(d: Deadline) {
    setError(null);
    try {
      const res = await fetch(`/api/business/deadlines/${d.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !d.done }),
      });
      if (!res.ok) throw new Error("Could not update the deadline.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the deadline.");
    }
  }

  async function removeDeadline(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/business/deadlines/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove the deadline.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the deadline.");
    }
  }

  async function uploadVault(file: File) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(typeof data?.detail === "string" ? data.detail : "Could not upload the file.");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload the file.");
    } finally {
      setBusy(false);
    }
  }

  async function checkDates(doc: VaultDoc) {
    setSuggestFor(doc.doc_id);
    setSuggestions([]);
    setSuggestBusy(true);
    try {
      const res = await fetch(`/api/business/vault/dates?docId=${encodeURIComponent(doc.doc_id)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.suggestions)) {
        throw new Error(typeof data?.detail === "string" ? data.detail : "Could not read dates from the file.");
      }
      setSuggestions(data.suggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read dates from the file.");
      setSuggestFor(null);
    } finally {
      setSuggestBusy(false);
    }
  }

  async function reviewDoc(doc: VaultDoc) {
    setReviewFor(doc.doc_id);
    setReviewFlags([]);
    setReviewNote("");
    setReviewBusy(true);
    try {
      const res = await fetch("/api/business/contracts/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_id: doc.doc_id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(typeof data?.detail === "string" ? data.detail : "The review could not run.");
      }
      setReviewFlags(Array.isArray(data.flags) ? data.flags : []);
      setReviewNote(typeof data.note === "string" ? data.note : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The review could not run.");
      setReviewFor(null);
    } finally {
      setReviewBusy(false);
    }
  }

  function sendFlagsToAdvocate(doc: VaultDoc) {
    setHSubject(`Contract review: ${doc.filename}`);
    setHDetails(
      reviewFlags.map((f) => `- ${f.title} (${f.risk}): ${f.citation.act} §${f.citation.section}`).join("\n"),
    );
    setHDocs([doc.doc_id]);
    document.getElementById("advocate-handoff")?.scrollIntoView({ behavior: "smooth" });
  }

  function trackSuggestion(doc: VaultDoc, s: Suggestion) {
    setTitle(`${doc.filename} — renewal`);
    setDueDate(s.date);
    setRecurrence("yearly");
    setSource(`Suggested from ${doc.filename}: check the original before relying on it.`);
    setProofDoc(doc.doc_id);
    setSuggestFor(null);
    setSuggestions([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleHDoc(id: string) {
    setHDocs((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  }

  async function sendHandoff(e: React.FormEvent) {
    e.preventDefault();
    if (!hLawyer || !hSubject.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/business/handoffs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lawyer_id: hLawyer,
          subject: hSubject.trim(),
          details: hDetails.trim(),
          doc_ids: hDocs,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(typeof data?.detail === "string" ? data.detail : "Could not send the request.");
      }
      setHLawyer("");
      setHSubject("");
      setHDetails("");
      setHDocs([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the request.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/business/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: pName.trim(),
          business_type: pType,
          city: pCity.trim(),
          turnover_band: pTurnover,
          headcount_band: pHeadcount,
          regulated_goods: pRegulated,
          holds_customer_data: pCustomerData,
        }),
      });
      if (!res.ok) throw new Error("Could not save the profile.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the profile.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-10 sm:px-6" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-lg bg-stone-900/60 motion-safe:animate-pulse" />
        ))}
      </div>
    );
  }

  const overdue = deadlines.filter((d) => d.state === "overdue");
  const dueSoon = deadlines.filter((d) => d.state === "due-soon");
  const open = deadlines.filter((d) => !d.done);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <div className="rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm leading-relaxed text-stone-200">
        Business is new here — more features are coming soon. Today you get deadline tracking
        and a document vault; advocate handoff and monthly law-change alerts arrive next.
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-red-900 bg-red-950 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}
      <section aria-label="Monthly snapshot" className={cardCls}>
        <h2 className="font-display text-lg text-stone-100">This month</h2>
        <p className="mt-1 text-sm leading-relaxed text-stone-400">
          Your records, summarized. Completed in the last 30 days, what is due next, and
          which coverage gaps need attention.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { n: String(snapshot?.overdue ?? overdue.length), label: "Overdue" },
            { n: String(snapshot?.dueSoon ?? dueSoon.length), label: "Due in 30 days" },
            { n: String(snapshot?.open ?? open.length), label: "Tracked" },
            { n: String(snapshot?.doneLast30 ?? 0), label: "Done in 30 days" },
            { n: String(snapshot?.vaultFiles ?? docs.length), label: "Vault files" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-stone-800 bg-stone-900/60 px-4 py-3">
              <p className="font-display text-2xl text-stone-100">{s.n}</p>
              <p className="text-xs text-stone-400">{s.label}</p>
            </div>
          ))}
        </div>
        {(snapshot?.gaps?.length ?? 0) > 0 ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-stone-200">Needs attention</h3>
            <ul className="mt-2 space-y-1.5">
              {snapshot!.gaps.map((g) => (
                <li key={g.label} className="rounded-md border border-gold/30 bg-gold/5 px-3 py-2 text-sm text-stone-200">
                  {g.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {(snapshot?.upcoming?.length ?? 0) > 0 ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-stone-200">Coming up</h3>
            <ul className="mt-2 space-y-1.5">
              {snapshot!.upcoming.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-2 rounded-md border border-stone-800 px-3 py-2 text-sm">
                  <span className="truncate text-stone-200">{u.title}</span>
                  <span className="shrink-0 text-xs text-stone-500">
                    {u.state === "overdue" ? `overdue by ${-u.daysUntil}d` : u.state === "due-soon" ? `in ${u.daysUntil}d` : u.due_date}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      <section aria-label="Deadlines" className={cardCls}>
        <h2 className="font-display text-lg text-stone-100">Deadlines</h2>
        <p className="mt-1 text-sm leading-relaxed text-stone-400">
          Renewals and filings with their dates. Mark one done and a recurring deadline rolls
          forward on its own. Dates you enter are your records; check them against the original.
        </p>
        <form onSubmit={addDeadline} className="mt-4 grid gap-2 sm:grid-cols-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. Trade licence renewal" maxLength={160} className={`${inputCls} sm:col-span-2`} />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} aria-label="Category">
            {CATEGORIES.map((c) => (
              <option key={c} value={c} className="capitalize">{c}</option>
            ))}
          </select>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required className={inputCls} aria-label="Due date" />
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className={inputCls} aria-label="Recurrence">
            {RECURRENCE.map((r) => (
              <option key={r} value={r}>{r === "none" ? "One-off" : r}</option>
            ))}
          </select>
          <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source note, e.g. licence page (optional)" maxLength={500} className={inputCls} />
          <div className="sm:col-span-2">
            <button type="submit" disabled={!title.trim() || !dueDate || busy} className={goldBtn}>
              {busy ? "Saving…" : "Track deadline"}
            </button>
          </div>
        </form>
        <ul className="mt-4 space-y-2">
          {open.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-stone-800 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-stone-100">{d.title}</p>
                <p className="mt-0.5 text-xs capitalize text-stone-500">
                  {d.category}
                  {d.recurrence !== "none" ? ` · repeats ${d.recurrence}` : ""}
                  {d.source_section ? ` · ${d.source_section}` : ""}
                </p>
              </div>
              {stateChip(d)}
              <button onClick={() => void setDone(d)} className={ghostBtn}>Done</button>
              <button onClick={() => void removeDeadline(d.id)} className={ghostBtn} aria-label={`Remove ${d.title}`}>Remove</button>
            </li>
          ))}
          {open.length === 0 ? (
            <li className="rounded-md border border-dashed border-stone-800 px-3 py-4 text-sm text-stone-500">
              Nothing tracked yet. Save your profile below and the starter renewals appear here.
            </li>
          ) : null}
        </ul>
      </section>
      <section aria-label="Document vault" className={cardCls}>
        <h2 className="font-display text-lg text-stone-100">Document vault</h2>
        <p className="mt-1 text-sm leading-relaxed text-stone-400">
          Licences, leases, and contracts live here privately. Checking dates reads the file and
          suggests expiry candidates; tracking one is always your tap, never automatic.
        </p>
        <label className={`${ghostBtn} mt-3 inline-block cursor-pointer`}>
          {busy ? "Uploading…" : "Upload a file"}
          <input
            type="file"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadVault(f);
              e.target.value = "";
            }}
          />
        </label>
        <ul className="mt-3 space-y-2">
          {docs.map((doc) => (
            <li key={doc.doc_id} className="rounded-md border border-stone-800 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm text-stone-200">{doc.filename}</p>
                <button onClick={() => void checkDates(doc)} disabled={suggestBusy} className={ghostBtn}>
                  {suggestBusy && suggestFor === doc.doc_id ? "Reading…" : "Check dates"}
                </button>
                <button onClick={() => void reviewDoc(doc)} disabled={reviewBusy} className={ghostBtn}>
                  {reviewBusy && reviewFor === doc.doc_id ? "Reviewing…" : "Review contract"}
                </button>
              </div>
              {reviewFor === doc.doc_id && !reviewBusy ? (
                <div className="mt-2 rounded bg-stone-900/60 px-2.5 py-2 text-xs">
                  <p className="text-stone-500">
                    Flags cite retrieved statutes only; this is information, not legal advice.
                    Confirm anything that matters with an advocate.
                  </p>
                  {reviewFlags.length > 0 ? (
                    <ul className="mt-2 space-y-2">
                      {reviewFlags.map((f, i) => (
                        <li key={i} className="rounded border border-stone-800 px-2.5 py-2">
                          <p className="text-sm font-medium text-stone-100">
                            {f.title}{" "}
                            <span className="ml-1 rounded-full bg-stone-800 px-2 py-0.5 text-[11px] capitalize text-stone-400">
                              {f.risk}
                            </span>
                          </p>
                          {f.clause ? <p className="mt-1 italic text-stone-400">“{f.clause}”</p> : null}
                          {f.explanation ? <p className="mt-1 leading-relaxed text-stone-300">{f.explanation}</p> : null}
                          <p className="mt-1 text-stone-500">
                            {f.citation.act} §{f.citation.section}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : reviewNote ? (
                    <p className="mt-2 text-stone-300">{reviewNote}</p>
                  ) : null}
                  {reviewFlags.length > 0 ? (
                    <button onClick={() => sendFlagsToAdvocate(doc)} className={`${ghostBtn} mt-2`}>
                      Send flags to an advocate
                    </button>
                  ) : null}
                </div>
              ) : null}
              {suggestFor === doc.doc_id && suggestions.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {suggestions.map((s) => (
                    <li key={s.date} className="flex flex-wrap items-center gap-2 rounded bg-stone-900/60 px-2.5 py-1.5 text-xs">
                      <span className="font-medium text-stone-100">{s.date}</span>
                      <span className="min-w-0 flex-1 truncate text-stone-500">{s.context}</span>
                      <button onClick={() => trackSuggestion(doc, s)} className={ghostBtn}>Track</button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {suggestFor === doc.doc_id && !suggestBusy && suggestions.length === 0 ? (
                <p className="mt-2 text-xs text-stone-500">No expiry dates found in this file. Add the deadline by hand above.</p>
              ) : null}
            </li>
          ))}
          {docs.length === 0 ? (
            <li className="rounded-md border border-dashed border-stone-800 px-3 py-4 text-sm text-stone-500">
              No files yet. Upload a trade licence to try date checking.
            </li>
          ) : null}
        </ul>
      </section>
      <section aria-label="Business profile" className={cardCls}>
        <h2 className="font-display text-lg text-stone-100">Business profile</h2>
        <p className="mt-1 text-sm leading-relaxed text-stone-400">
          A few facts decide which starter renewals apply. Saving the profile for the first time
          adds them to your deadlines; editing later never duplicates them.
        </p>
        <form onSubmit={saveProfile} className="mt-4 grid gap-2 sm:grid-cols-2">
          <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Business name" maxLength={120} className={`${inputCls} sm:col-span-2`} />
          <select value={pType} onChange={(e) => setPType(e.target.value)} className={inputCls} aria-label="Business type">
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <input value={pCity} onChange={(e) => setPCity(e.target.value)} placeholder="City" maxLength={80} className={inputCls} />
          <input value={pTurnover} onChange={(e) => setPTurnover(e.target.value)} placeholder="Turnover band, e.g. under Tk 50 lakh" maxLength={40} className={inputCls} />
          <input value={pHeadcount} onChange={(e) => setPHeadcount(e.target.value)} placeholder="Headcount, e.g. 1-9" maxLength={40} className={inputCls} />
          <label className="flex items-center gap-2 text-sm text-stone-300">
            <input type="checkbox" checked={pRegulated} onChange={(e) => setPRegulated(e.target.checked)} className="size-4 accent-[#c9a227]" />
            Sells regulated goods (medicine, food, chemicals)
          </label>
          <label className="flex items-center gap-2 text-sm text-stone-300">
            <input type="checkbox" checked={pCustomerData} onChange={(e) => setPCustomerData(e.target.checked)} className="size-4 accent-[#c9a227]" />
            Holds customer personal data
          </label>
          <div className="sm:col-span-2">
            <button type="submit" disabled={busy} className={goldBtn}>
              {busy ? "Saving…" : profile ? "Save profile" : "Save profile and add starter renewals"}
            </button>
          </div>
        </form>
      </section>
      <section aria-label="Advocate handoff" id="advocate-handoff" className={cardCls}>
        <h2 className="font-display text-lg text-stone-100">Ask an advocate</h2>
        <p className="mt-1 text-sm leading-relaxed text-stone-400">
          Package your facts and vault files for a verified lawyer. They read what you share
          and continue the matter in their own channel; the dashboard only tracks the request.
        </p>
        <form onSubmit={sendHandoff} className="mt-4 grid gap-2">
          <select value={hLawyer} onChange={(e) => setHLawyer(e.target.value)} required className={inputCls} aria-label="Lawyer">
            <option value="">Choose a verified lawyer…</option>
            {lawyers.map((l) => (
              <option key={l.user_id} value={l.user_id}>
                {l.display_name}
                {l.practice_areas?.length ? ` — ${l.practice_areas.slice(0, 3).join(", ")}` : ""}
                {l.city ? ` (${l.city})` : ""}
              </option>
            ))}
          </select>
          <input value={hSubject} onChange={(e) => setHSubject(e.target.value)} placeholder="Subject, e.g. Review supplier contract" maxLength={160} required className={inputCls} />
          <textarea value={hDetails} onChange={(e) => setHDetails(e.target.value)} placeholder="The facts: what happened, what you need, dates that matter (optional)" maxLength={2000} rows={3} className={inputCls} />
          {docs.length > 0 ? (
            <fieldset>
              <legend className="text-xs text-stone-500">Share files with the lawyer</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {docs.map((d) => (
                  <label key={d.doc_id} className="flex cursor-pointer items-center gap-1.5 rounded-md border border-stone-800 px-2.5 py-1.5 text-xs text-stone-300">
                    <input type="checkbox" checked={hDocs.includes(d.doc_id)} onChange={() => toggleHDoc(d.doc_id)} className="size-3.5 accent-[#c9a227]" />
                    <span className="max-w-48 truncate">{d.filename}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <div>
            <button type="submit" disabled={!hLawyer || !hSubject.trim() || busy} className={goldBtn}>
              {busy ? "Sending…" : "Send request"}
            </button>
          </div>
        </form>
        {handoffs.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {handoffs.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2 rounded-md border border-stone-800 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-stone-100">{h.subject}</p>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {h.lawyer_name} · {h.created} · {h.status}
                    {h.lawyer_note ? ` — ${h.lawyer_note}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
