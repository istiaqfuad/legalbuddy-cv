"use client";

import { useCallback, useEffect, useState } from "react";

/** Incoming advocate-handoff requests for a verified lawyer. The owner
 * packaged their facts and vault files; accept or close with a note.
 * Shared files are the owner's own uploads, shown only for requests
 * assigned to this lawyer.
 */

interface Handoff {
  id: string;
  subject: string;
  details: string;
  doc_ids: string[];
  status: "open" | "accepted" | "closed";
  lawyer_note: string;
  created: string;
  preferred_date: string | null;
  owner_name: string;
  business_name: string;
}

interface SharedFile {
  doc_id: string;
  filename: string;
  chunks: string[];
}

const cardCls = "rounded-lg border border-stone-800 bg-stone-900/40 p-5";
const ghostBtn =
  "rounded-md border border-stone-700 px-3 py-1.5 text-sm text-stone-300 transition-colors hover:border-stone-500 hover:text-stone-100 disabled:cursor-not-allowed disabled:opacity-60";

export default function LawyerRequests() {
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [filesBusy, setFilesBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lawyer/handoffs");
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "Could not load requests.");
      setHandoffs(Array.isArray(data.handoffs) ? data.handoffs : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load requests.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Deferred past the mount pass: the initial fetch populates state
    // but must not run synchronously inside the effect body.
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function openHandoff(h: Handoff) {
    if (openId === h.id) {
      setOpenId(null);
      return;
    }
    setOpenId(h.id);
    setNote(h.lawyer_note ?? "");
    setFiles([]);
    if (!h.doc_ids?.length) return;
    setFilesBusy(true);
    try {
      const res = await fetch(`/api/lawyer/handoffs/${h.id}/documents`);
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data?.files)) setFiles(data.files);
    } catch {
      setError("Could not read the shared files.");
    } finally {
      setFilesBusy(false);
    }
  }

  async function setStatus(h: Handoff, status: "accepted" | "closed") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lawyer/handoffs/${h.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, lawyer_note: note.trim() }),
      });
      if (!res.ok) throw new Error("Could not update the request.");
      setOpenId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the request.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-10 sm:px-6" aria-busy="true">
        {[0, 1].map((i) => (
          <div key={i} className="h-28 rounded-lg bg-stone-900/60 motion-safe:animate-pulse" />
        ))}
      </div>
    );
  }

  const open = handoffs.filter((h) => h.status === "open");

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="font-display text-2xl text-stone-100">Business requests</h1>
        <p className="mt-1 text-sm leading-relaxed text-stone-400">
          Owners package their facts and files for you. Read what they shared, accept the
          requests you can take, and continue the matter in your own channel.
        </p>
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-red-900 bg-red-950 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}
      <p className="text-sm text-stone-500">
        {open.length === 0 ? "No open requests." : `${open.length} open request${open.length === 1 ? "" : "s"}.`}
      </p>
      <ul className="space-y-3">
        {handoffs.map((h) => (
          <li key={h.id} className={cardCls}>
            <button onClick={() => void openHandoff(h)} className="flex w-full flex-wrap items-center gap-2 text-left">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-stone-100">{h.subject}</span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  {h.business_name || h.owner_name} · {h.created} · {h.status}
                  {h.preferred_date ? ` · prefers visit ${h.preferred_date}` : ""}
                </span>
              </span>
              <span className="text-xs text-stone-500">{openId === h.id ? "Hide" : "View"}</span>
            </button>
            {openId === h.id ? (
              <div className="mt-3 space-y-3 border-t border-stone-800 pt-3">
                {h.details ? <p className="text-sm leading-relaxed whitespace-pre-wrap text-stone-300">{h.details}</p> : null}
                {filesBusy ? (
                  <p className="text-xs text-stone-500">Reading shared files…</p>
                ) : files.length > 0 ? (
                  <div className="space-y-2">
                    {files.map((f) => (
                      <details key={f.doc_id} className="rounded-md border border-stone-800 px-3 py-2">
                        <summary className="cursor-pointer text-sm text-stone-200">{f.filename}</summary>
                        <div className="mt-2 max-h-64 space-y-2 overflow-y-auto text-xs leading-relaxed text-stone-400">
                          {f.chunks.map((c, i) => (
                            <p key={i} className="whitespace-pre-wrap">{c.slice(0, 2000)}</p>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                ) : h.doc_ids?.length ? (
                  <p className="text-xs text-stone-500">Shared files could not be read.</p>
                ) : null}
                {h.status === "open" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Note for the owner (optional)"
                      maxLength={1000}
                      className="min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-900/60 px-3 py-1.5 text-sm text-stone-100 placeholder:text-stone-500 focus:border-gold focus:outline-none"
                    />
                    <button onClick={() => void setStatus(h, "accepted")} disabled={busy} className={ghostBtn}>
                      Accept
                    </button>
                    <button onClick={() => void setStatus(h, "closed")} disabled={busy} className={ghostBtn}>
                      Decline
                    </button>
                  </div>
                ) : h.lawyer_note ? (
                  <p className="text-xs text-stone-500">Your note: {h.lawyer_note}</p>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
