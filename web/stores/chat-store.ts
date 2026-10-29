/** Conversation state: the single seam for everything chat-related.
 *
 * Interface: `messages`, `pending`, `failed`, `flash`, plus `send`,
 * `stop`, `regenerate`, history actions, and sidebar controls. All
 * streaming orchestration, accumulation, persistence, and failure
 * cleanup live inside; components only render and forward user intent.
 */

import { create } from "zustand";
import { streamChat } from "@/lib/chat-api";
import type { ChatMessage, Citation, Conversation } from "@/lib/types";

async function saveMessage(
  conversationId: string,
  msg: { role: "user" | "assistant"; content: string; citations?: Citation[] },
): Promise<void> {
  try {
    await fetch(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...msg, citations: msg.citations ?? [] }),
    });
  } catch (err) {
    // History must never break the chat itself.
    console.error("message save failed", err);
  }
}

interface ChatState {
  messages: ChatMessage[];
  pending: boolean;
  failed: boolean;
  flash: number | null;
  /** Sidebar source list. `citations` belongs to the message that opened it. */
  sidebarOpen: boolean;
  sidebarPinned: boolean;
  sidebarCitations: Citation[];
  expandedRef: number | null;
  /** Left history rail. */
  historyOpen: boolean;
  /** Persisted history. Null activeId means the chat is new and unsaved. */
  activeId: string | null;
  conversations: Conversation[];
  historyLoading: boolean;
  send: (question: string) => Promise<void>;
  stop: () => void;
  regenerate: () => Promise<void>;
  dismissError: () => void;
  /** Open the sidebar on `citations`, expanding only `ref` (null = all shut). */
  openSources: (citations: Citation[], ref: number | null) => void;
  closeSidebar: () => void;
  togglePin: () => void;
  toggleSource: (ref: number) => void;
  toggleHistory: () => void;
  setHistoryOpen: (open: boolean) => void;
  refreshConversations: () => Promise<void>;
  newChat: () => void;
  openConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;
/** Aborts the in-flight answer stream; replaced on every send. */
let streamAbort: AbortController | null = null;

function replaceAt(
  messages: ChatMessage[],
  id: number,
  patch: Partial<ChatMessage>,
): ChatMessage[] {
  return messages.map((m, i) => (i === id ? { ...m, ...patch } : m));
}

export const useChatStore = create<ChatState>()((set, get) => {
  /** Stream one answer into `messages[assistantId]` and persist it. */
  async function runAssistant(question: string, assistantId: number): Promise<void> {
    const conversationId = get().activeId;
    // Local accumulator: state reads would go stale when several token
    // events land in one read chunk.
    let acc = "";
    let finalCitations: Citation[] = [];
    let finished = false;
    const ctrl = new AbortController();
    streamAbort = ctrl;
    try {
      for await (const ev of streamChat(question, { signal: ctrl.signal })) {
        if (ev.type === "token") {
          acc += ev.text;
          const text = acc;
          set((s) => ({ messages: replaceAt(s.messages, assistantId, { text }) }));
        } else {
          if (ev.citations.length > 0 || ev.type === "done") {
            if (ev.citations.length > 0) finalCitations = ev.citations;
            set((s) => ({
              messages: replaceAt(s.messages, assistantId, {
                ...(ev.citations.length > 0 ? { citations: ev.citations } : {}),
                ...(ev.type === "done" && ev.answer ? { text: ev.answer } : {}),
              }),
            }));
          }
          if (ev.type === "done" && ev.answer) {
            finished = true;
            if (!acc) acc = ev.answer;
          }
        }
      }
      // Stream ended with neither tokens nor a final answer: failure, not silence.
      if (!acc && !finished) throw new Error("empty stream");
      if (conversationId && finished) {
        await saveMessage(conversationId, {
          role: "assistant",
          content: acc,
          citations: finalCitations,
        });
        // Keep the edited chat at the top without a refetch round-trip.
        const cid = conversationId;
        set((s) => ({
          conversations: [
            ...s.conversations.filter((c) => c.id === cid),
            ...s.conversations.filter((c) => c.id !== cid),
          ],
        }));
      }
    } catch {
      if (ctrl.signal.aborted) {
        // The user stopped it: keep the partial answer, save what exists,
        // and stay quiet instead of showing the error banner.
        if (acc && conversationId) {
          await saveMessage(conversationId, {
            role: "assistant",
            content: acc,
            citations: finalCitations,
          });
        }
        if (!acc) {
          set((s) => ({ messages: s.messages.filter((_, i) => i !== assistantId) }));
        }
        return;
      }
      set((s) => {
        const target = s.messages[assistantId];
        const messages =
          target && target.role === "assistant" && !target.text
            ? s.messages.filter((_, i) => i !== assistantId)
            : s.messages;
        return { messages, failed: true };
      });
    } finally {
      if (streamAbort === ctrl) streamAbort = null;
      set({ pending: false });
    }
  }

  return {
    messages: [],
    pending: false,
    failed: false,
    flash: null,
    sidebarOpen: false,
    sidebarPinned: false,
    sidebarCitations: [],
    expandedRef: null,
    historyOpen: true,
    activeId: null,
    conversations: [],
    historyLoading: false,

    refreshConversations: async () => {
      try {
        const res = await fetch("/api/conversations");
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data?.conversations)) set({ conversations: data.conversations });
      } catch (err) {
        console.error("conversation list failed", err);
      }
    },

    newChat: () =>
      set({
        messages: [],
        activeId: null,
        failed: false,
        sidebarOpen: false,
        sidebarCitations: [],
        expandedRef: null,
      }),

    openConversation: async (id) => {
      if (get().pending) return;
      set({ historyLoading: true, failed: false, sidebarOpen: false });
      try {
        const res = await fetch(`/api/conversations/${id}`);
        if (!res.ok) throw new Error("not found");
        const data = await res.json();
        const messages: ChatMessage[] = (data.messages ?? []).map(
          (m: { role: "user" | "assistant"; content: string; citations: Citation[] }) => ({
            role: m.role,
            text: m.content,
            citations: Array.isArray(m.citations) ? m.citations : [],
          }),
        );
        set({ messages, activeId: id, expandedRef: null, sidebarCitations: [] });
      } catch (err) {
        console.error("conversation open failed", err);
        set({ failed: true });
      } finally {
        set({ historyLoading: false });
      }
    },

    renameConversation: async (id, title) => {
      const t = title.trim().slice(0, 80);
      if (!t) return;
      set((s) => ({
        conversations: s.conversations.map((c) => (c.id === id ? { ...c, title: t } : c)),
      }));
      try {
        await fetch(`/api/conversations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: t }),
        });
      } catch (err) {
        console.error("conversation rename failed", err);
      }
    },

    deleteConversation: async (id) => {
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== id),
        ...(s.activeId === id
          ? { activeId: null, messages: [], sidebarOpen: false, sidebarCitations: [] }
          : {}),
      }));
      try {
        await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      } catch (err) {
        console.error("conversation delete failed", err);
      }
    },

    dismissError: () => set({ failed: false }),

    toggleSource: (ref) =>
      set((s) => ({ expandedRef: s.expandedRef === ref ? null : ref })),

    openSources: (citations, ref) => {
      set({ sidebarOpen: true, sidebarCitations: citations, expandedRef: ref });
      if (ref !== null) {
        set({ flash: ref });
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(() => set({ flash: null }), 1800);
      }
    },

    closeSidebar: () => set({ sidebarOpen: false }),

    togglePin: () => set((s) => ({ sidebarPinned: !s.sidebarPinned })),

    toggleHistory: () => set((s) => ({ historyOpen: !s.historyOpen })),

    setHistoryOpen: (open) => set({ historyOpen: open }),

    send: async (question) => {
      const q = question.trim();
      if (!q || get().pending) return;
      // Persist first: brand-new chats get a conversation row titled by
      // the opening question, so history survives reloads mid-stream.
      if (!get().activeId) {
        try {
          const res = await fetch("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: q.slice(0, 60) }),
          });
          if (res.ok) {
            const data = await res.json();
            set((s) => ({
              activeId: data.conversation.id as string,
              conversations: [data.conversation, ...s.conversations],
            }));
          }
        } catch (err) {
          console.error("conversation create failed", err);
        }
      }
      const conversationId = get().activeId;
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
      if (conversationId) void saveMessage(conversationId, { role: "user", content: q });
      await runAssistant(q, id);
    },

    stop: () => {
      streamAbort?.abort();
    },

    regenerate: async () => {
      const msgs = get().messages;
      if (get().pending || msgs.length === 0) return;
      let userIdx = -1;
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === "user") {
          userIdx = i;
          break;
        }
      }
      if (userIdx < 0) return;
      const q = msgs[userIdx].text;
      const assistantId = userIdx + 1;
      set((s) => ({
        failed: false,
        pending: true,
        messages: [
          ...s.messages.slice(0, userIdx + 1),
          { role: "assistant", text: "", citations: [] },
        ],
      }));
      // The question is already saved; only the fresh answer persists.
      await runAssistant(q, assistantId);
    },
  };
});
