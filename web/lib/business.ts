import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { subscriptionActive } from "@/lib/stripe";

/** Business-tier access and the deterministic deadline rules engine.
 *
 * Dates are data, never model output: the API rolls recurring deadlines
 * forward on completion and labels states from the calendar. Nothing
 * here interprets law; citations ride along as text for the owner to
 * verify.
 */

export interface DeadlineRow {
  id: string;
  title: string;
  category: string;
  due_date: string;
  recurrence: string;
  source_section: string;
  source_url: string;
  done: boolean;
  proof_doc_id: string | null;
}

export type DeadlineState = "overdue" | "due-soon" | "later" | "done";

/** Signed-in owner with a current Business subscription, else null. */
export async function businessOwner(): Promise<{ id: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  try {
    const rows = (await getDb().query(
      "SELECT plan, subscription_status FROM users WHERE id = $1",
      [session.user.id],
    )) as Array<{ plan: string; subscription_status: string | null }>;
    const r = rows[0];
    if (r?.plan === "business" && subscriptionActive(r.subscription_status ?? null)) {
      return { id: session.user.id };
    }
    return null;
  } catch (err) {
    console.error(`business gate failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Calendar state of one deadline relative to today. */
export function deadlineState(
  dueDate: string,
  done: boolean,
  today: Date = startOfToday(),
): { state: DeadlineState; daysUntil: number } {
  if (done) return { state: "done", daysUntil: 0 };
  const due = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return { state: "later", daysUntil: 0 };
  const daysUntil = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (daysUntil < 0) return { state: "overdue", daysUntil };
  if (daysUntil <= 30) return { state: "due-soon", daysUntil };
  return { state: "later", daysUntil };
}

/** Next due date after completing a recurring deadline (null = one-off). */
export function rollForward(dueDate: string, recurrence: string): string | null {
  const months = recurrence === "monthly" ? 1 : recurrence === "quarterly" ? 3 : recurrence === "yearly" ? 12 : 0;
  if (!months) return null;
  const d = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Clamp month-end (e.g. Jan 31 + 1 month -> Feb 28, not Mar 3).
  if (d.getDate() < day) d.setDate(0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Next 30 June on or after today (trade licence renewal anchor). */
export function nextJune30(today: Date = startOfToday()): string {
  const year = today.getFullYear();
  const june30 = new Date(year, 5, 30);
  const y = june30 >= today ? year : year + 1;
  return `${y}-06-30`;
}

/** Starter obligations for a new profile. Dates are anchors the owner
 * edits — the dashboard never claims a cited statute behind them. */
export async function seedDeadlines(
  userId: string,
  holdsCustomerData: boolean,
): Promise<void> {
  const seeds: Array<{ title: string; category: string; due: string; rec: string; src: string }> = [
    {
      title: "Trade licence renewal",
      category: "licence",
      due: nextJune30(),
      rec: "yearly",
      src: "Yearly renewal — confirm the exact date on your licence.",
    },
  ];
  if (holdsCustomerData) {
    seeds.push({
      title: "Customer-data handling review",
      category: "data",
      due: nextJune30(),
      rec: "yearly",
      src: "Yearly check that consent records and storage match the Personal Data Protection Act 2026.",
    });
  }
  for (const s of seeds) {
    await getDb().query(
      `INSERT INTO business_deadlines (user_id, title, category, due_date, recurrence, source_section)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, s.title, s.category, s.due, s.rec, s.src],
    );
  }
}
