"use client";

import { useEffect, useRef } from "react";

/** Small confirmation dialog for irreversible billing actions
 * (cancel, downgrade). Rendered only while open: Esc or backdrop click
 * closes, focus starts on the safe choice, and the confirm button shows
 * a busy state while the request runs. */
export default function ConfirmModal({
  title,
  body,
  confirmLabel,
  busyLabel = "Please wait…",
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="w-full max-w-sm rounded-xl border border-stone-700 bg-stone-950 p-6 shadow-xl shadow-black/50"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="font-display text-lg text-stone-50">
          {title}
        </h2>
        <p id="confirm-body" className="mt-2 text-sm leading-relaxed text-stone-400">
          {body}
        </p>
        <div className="mt-5 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-md border border-stone-700 px-4 py-2 text-sm text-stone-300 transition-colors hover:border-stone-500 disabled:opacity-60"
          >
            Keep my plan
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-md bg-red-800 px-4 py-2 text-sm font-semibold text-stone-50 transition-colors hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
