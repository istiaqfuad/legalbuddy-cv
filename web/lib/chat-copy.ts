/** User-facing chat words. One home so future copy edits land in one file. */

export const SUGGESTIONS = [
  "Can my landlord evict me without any notice?",
  "খুনের শাস্তি কী?",
  "My salary is two months late. What does the law say?",
];

/** Shown for every failure. Upstream details stay in server logs. */
export const FRIENDLY_ERROR =
  "The assistant is unavailable right now. Please try again in a moment.";

export interface ExportableCitation {
  kind: string;
  ref: number;
  section_label: string;
  section_title: string;
  act_title: string;
  act_no: string;
  act_year: string;
  doc_filename: string;
  doc_page: number | null;
  excerpt: string;
  source_url: string;
}

export interface ExportableMessage {
  role: "user" | "assistant";
  text: string;
  citations?: ExportableCitation[];
}

/** Render a conversation as Markdown for download. Markers ([1], [D1])
 * stay inline; the Sources section resolves them the way the sidebar does.
 */
export function conversationToMarkdown(
  messages: ExportableMessage[],
  title: string,
): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const msg of messages) {
    if (msg.role === "user") {
      lines.push(`## You`, "", msg.text, "");
    } else if (msg.text) {
      lines.push(`## LegalBuddy`, "", msg.text, "");
      const cites = msg.citations ?? [];
      if (cites.length > 0) {
        lines.push(`### Sources`, "");
        for (const c of cites) {
          if (c.kind === "document") {
            const where = c.doc_page ? `, page ${c.doc_page}` : "";
            lines.push(`- [D${c.ref}] ${c.doc_filename}${where}`);
          } else {
            const section =
              c.section_label && c.section_label !== "?" ? `Section ${c.section_label}` : "Provision";
            lines.push(`- [${c.ref}] ${section} — ${c.act_title} (${c.act_no} of ${c.act_year})`);
            if (c.source_url) lines.push(`  ${c.source_url}`);
          }
        }
        lines.push("");
      }
    }
  }
  lines.push(
    "---",
    "",
    "Research assistance only, not a substitute for a lawyer. Verify important claims against the linked act.",
    "",
  );
  return lines.join("\n");
}
