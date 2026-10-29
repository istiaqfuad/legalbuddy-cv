/** Conversation state: the single seam for everything chat-related.
 *
 * Interface: `messages`, `pending`, `failed`, `flash`, plus three
 * actions — `send`, `dismissError`, `jumpTo`. All streaming
 * orchestration, accumulation, and failure cleanup live inside;
 * components only render and forward user intent.
 */

import { create } from "zustand";
import { streamChat } from "@/lib/chat-api";
import type { ChatMessage } from "@/lib/types";

interface ChatState {
  messages: ChatMessage[];
  pending: boolean;
  failed: boolean;
  flash: number | null;
  send: (question: string) => Promise<void>;
  dismissError: () => void;
  jumpTo: (ref: number) => void;
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;

function replaceAt(
  messages: ChatMessage[],
  id: number,
  patch: Partial<ChatMessage>,
): ChatMessage[] {
  return messages.map((m, i) => (i === id ? { ...m, ...patch } : m));
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  pending: false,
  failed: false,
  flash: null,

  dismissError: () => set({ failed: false }),

  jumpTo: (ref) => {
    document
      .getElementById(`cite-card-${ref}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    set({ flash: ref });
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => set({ flash: null }), 1800);
  },

  send: async (question) => {
    const q = question.trim();
    if (!q || get().pending) return;
    const id = get().messages.length + 1;
    set((s) => ({
      failed: false,
      pending: true,
      messages: [
        ...s.messages,
        { role: "user", text: q },
        { role: "assistant", text: "", citations: [] },
      ],
    }));
    // Local accumulator: state reads would go stale when several token
    // events land in one read chunk.
    let acc = "";
    let finished = false;
    try {
      for await (const ev of streamChat(q)) {
        if (ev.type === "token") {
          acc += ev.text;
          const text = acc;
          set((s) => ({ messages: replaceAt(s.messages, id, { text }) }));
        } else {
          if (ev.citations.length > 0 || ev.type === "done") {
            set((s) => ({
              messages: replaceAt(s.messages, id, {
                ...(ev.citations.length > 0 ? { citations: ev.citations } : {}),
                ...(ev.type === "done" && ev.answer ? { text: ev.answer } : {}),
              }),
            }));
          }
          if (ev.type === "done" && ev.answer) finished = true;
        }
      }
      // Stream ended with neither tokens nor a final answer: failure, not silence.
      if (!acc && !finished) throw new Error("empty stream");
    } catch {
      set((s) => {
        const target = s.messages[id];
        const messages =
          target && target.role === "assistant" && !target.text
            ? s.messages.filter((_, i) => i !== id)
            : s.messages;
        return { messages, failed: true };
      });
    } finally {
      set({ pending: false });
    }
  },
}));
