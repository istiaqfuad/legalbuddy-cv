/** Conversation state: the single seam for everything chat-related.
 *
 * Interface: `messages` (the visible chat), `pending` (the visible chat is
 * streaming), `failed`, `flash`, plus `send`, `stop`, `regenerate`,
 * history actions, and sidebar controls. Streaming runs per conversation
 * in the background: switching chats never stops or corrupts a running
 * answer. `buffers` holds every live conversation's messages, `busy`
 * marks which conversations are streaming, and `messages` simply mirrors
 * the buffer of the active one. Components only render and forward intent.
 */

import { create } from "zustand";
import { streamChat } from "@/lib/chat-api";
import type { ChatMessage, Citation, Conversation, UserDocument } from "@/lib/types";

/** Sidebar card key: `s1` for statute [1], `d1` for document [D1]. */
export function citationKey(c: Citation): string {
  return `${c.kind === "document" ? "d" : "s"}${c.ref}`;
}

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
  /** Per-conversation message buffers; `messages` mirrors the active one. */
  buffers: Record<string, ChatMessage[]>;
  /** Conversations with a live stream right now. */
  busy: Record<string, boolean>;
  failed: boolean;
  flash: string | null;
  /** Sidebar source list. `citations` belongs to the message that opened it. */
  sidebarOpen: boolean;
  sidebarPinned: boolean;
  sidebarCitations: Citation[];
  expandedRef: string | null;
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
  openSources: (citations: Citation[], ref: string | null) => void;
  closeSidebar: () => void;
  togglePin: () => void;
  toggleSource: (ref: string) => void;
  /** Documents attached to the active chat (scoped retrieval per question). */
  attachedIds: string[];
  documents: UserDocument[];
  uploading: boolean;
  uploadError: string | null;
  refreshDocuments: () => Promise<void>;
  uploadDocument: (file: File) => Promise<void>;
  attachDocument: (docId: string) => Promise<void>;
  detachDocument: (docId: string) => Promise<void>;
  removeDocument: (docId: string) => Promise<void>;
  toggleHistory: () => void;
  setHistoryOpen: (open: boolean) => void;
  refreshConversations: () => Promise<void>;
  newChat: () => void;
  openConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * One live stream per conversation. A new run in the same conversation
 * bumps its generation: late events from the superseded run fail the
 * `alive` check and can neither write state nor save messages. Deleting a
 * conversation bumps its generation first, so an abort that lands late
 * cannot resurrect it.
 */
const streamControllers: Record<string, AbortController> = {};
const streamGen: Record<string, number> = {};

function replaceAt(
  messages: ChatMessage[],
  id: number,
  patch: Partial<ChatMessage>,
): ChatMessage[] {
  return messages.map((m, i) => (i === id ? { ...m, ...patch } : m));
}

export const useChatStore = create<ChatState>()((set, get) => {
  /**
   * Stream one answer into `buffers[conversationId][assistantId]`.
   * The visible `messages` mirrors the buffer only while its conversation
   * is active, so navigating away neither stops nor corrupts the stream.
   * The generation token makes superseded runs (stop-then-send, delete)
   * harmless: their late events fail `alive` and write nothing.
   */
  async function runAssistant(
    question: string,
    assistantId: number,
    conversationId: string,
  ): Promise<void> {
    const docIds = get().attachedIds;
    // Local accumulator: state reads would go stale when several token
    // events land in one read chunk.
    let acc = "";
    let finalCitations: Citation[] = [];
    let finished = false;
    const ctrl = new AbortController();
    streamControllers[conversationId] = ctrl;
    const gen = (streamGen[conversationId] ?? 0) + 1;
    streamGen[conversationId] = gen;
    const alive = () => streamGen[conversationId] === gen;
    set((s) => ({
      busy: { ...s.busy, [conversationId]: true },
      ...(conversationId === s.activeId ? { pending: true } : {}),
    }));
    /** Patch the buffer; mirror to the view only when active. */
    const patch = (fn: (msgs: ChatMessage[]) => ChatMessage[]) =>
      set((s) => {
        const next = fn(s.buffers[conversationId] ?? []);
        const buffers = { ...s.buffers, [conversationId]: next };
        return conversationId === s.activeId ? { buffers, messages: next } : { buffers };
      });
    try {
      for await (const ev of streamChat(question, {
        signal: ctrl.signal,
        docIds,
        conversationId,
      })) {
        if (!alive()) return;
        if (ev.type === "token") {
          acc += ev.text;
          const text = acc;
          patch((msgs) => replaceAt(msgs, assistantId, { text }));
        } else {
          if (ev.citations.length > 0 || ev.type === "done") {
            if (ev.citations.length > 0) finalCitations = ev.citations;
            patch((msgs) =>
              replaceAt(msgs, assistantId, {
                ...(ev.citations.length > 0 ? { citations: ev.citations } : {}),
                ...(ev.type === "done" && ev.answer ? { text: ev.answer } : {}),
              }),
            );
          }
          if (ev.type === "done" && ev.answer) {
            finished = true;
            if (!acc) acc = ev.answer;
          }
        }
      }
      if (!alive()) return;
      // Stream ended with neither tokens nor a final answer: failure, not silence.
      if (!acc && !finished) throw new Error("empty stream");
      if (finished) {
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
      if (!alive()) return;
      if (ctrl.signal.aborted) {
        // The user stopped it: keep the partial answer, save what exists,
        // and stay quiet instead of showing the error banner.
        if (acc) {
          await saveMessage(conversationId, {
            role: "assistant",
            content: acc,
            citations: finalCitations,
          });
        }
        if (!acc) {
          patch((msgs) => msgs.filter((_, i) => i !== assistantId));
        }
        return;
      }
      patch((msgs) => {
        const target = msgs[assistantId];
        return target && target.role === "assistant" && !target.text
          ? msgs.filter((_, i) => i !== assistantId)
          : msgs;
      });
      // A background failure must not raise the banner on another chat.
      if (conversationId === get().activeId) set({ failed: true });
    } finally {
      if (streamControllers[conversationId] === ctrl) {
        delete streamControllers[conversationId];
      }
      if (alive()) {
        set((s) => {
          const busy = { ...s.busy };
          delete busy[conversationId];
          return {
            busy,
            ...(conversationId === s.activeId ? { pending: false } : {}),
          };
        });
      }
    }
  }

  return {
    messages: [],
    pending: false,
    buffers: {},
    busy: {},
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
    attachedIds: [],
    documents: [],
    uploading: false,
    uploadError: null,

    refreshDocuments: async () => {
      try {
        const res = await fetch("/api/documents");
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data?.documents)) set({ documents: data.documents });
      } catch (err) {
        console.error("documents list failed", err);
      }
    },

    uploadDocument: async (file) => {
      if (get().uploading) return;
      set({ uploading: true, uploadError: null });
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        const res = await fetch("/api/documents", { method: "POST", body: form });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.document?.doc_id) {
          set({
            uploadError:
              typeof data?.detail === "string" && data.detail
                ? data.detail
                : "Could not process the file. Please try again.",
          });
          return;
        }
        const doc = data.document as UserDocument;
        set((s) => ({ documents: [doc, ...s.documents] }));
        await get().attachDocument(doc.doc_id);
      } catch (err) {
        console.error("document upload failed", err);
        set({ uploadError: "Could not process the file. Please try again." });
      } finally {
        set({ uploading: false });
      }
    },

    attachDocument: async (docId) => {
      if (get().attachedIds.includes(docId)) return;
      set((s) => ({ attachedIds: [...s.attachedIds, docId] }));
      const activeId = get().activeId;
      if (!activeId) return;
      try {
        await fetch(`/api/conversations/${activeId}/documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ document_id: docId }),
        });
      } catch (err) {
        console.error("document attach failed", err);
      }
    },

    detachDocument: async (docId) => {
      set((s) => ({ attachedIds: s.attachedIds.filter((d) => d !== docId) }));
      const activeId = get().activeId;
      if (!activeId) return;
      try {
        await fetch(
          `/api/conversations/${activeId}/documents?document_id=${encodeURIComponent(docId)}`,
          { method: "DELETE" },
        );
      } catch (err) {
        console.error("document detach failed", err);
      }
    },

    removeDocument: async (docId) => {
      set((s) => ({
        documents: s.documents.filter((d) => d.doc_id !== docId),
        attachedIds: s.attachedIds.filter((d) => d !== docId),
      }));
      try {
        await fetch(`/api/documents/${encodeURIComponent(docId)}`, { method: "DELETE" });
      } catch (err) {
        console.error("document remove failed", err);
      }
    },

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

    // View-only: background streams keep running in their own buffers.
    newChat: () =>
      set({
        messages: [],
        activeId: null,
        pending: false,
        failed: false,
        sidebarOpen: false,
        sidebarCitations: [],
        expandedRef: null,
        attachedIds: [],
      }),

    openConversation: async (id) => {
      if (id === get().activeId) return;
      // A live buffer beats a server fetch: the server copy lacks the
      // in-flight partial answer.
      const buffered = get().buffers[id];
      set({
        activeId: id,
        failed: false,
        sidebarOpen: false,
        pending: !!get().busy[id],
        ...(buffered ? { messages: buffered } : {}),
      });
      if (buffered) {
        try {
          const linkRes = await fetch(`/api/conversations/${id}/documents`);
          if (linkRes.ok) {
            const linkData = await linkRes.json();
            const ids = Array.isArray(linkData?.documents)
              ? linkData.documents.map((d: { doc_id: string }) => d.doc_id)
              : [];
            set({ attachedIds: ids });
          } else {
            set({ attachedIds: [] });
          }
        } catch (err) {
          console.error("attached documents load failed", err);
          set({ attachedIds: [] });
        }
        return;
      }
      set({ historyLoading: true });
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
        // Seed the buffer so a later stream (or a revisit) patches this
        // same array instead of diverging from the view.
        set((s) => ({
          messages,
          activeId: id,
          expandedRef: null,
          sidebarCitations: [],
          buffers: { ...s.buffers, [id]: messages },
        }));
        try {
          const linkRes = await fetch(`/api/conversations/${id}/documents`);
          if (linkRes.ok) {
            const linkData = await linkRes.json();
            const ids = Array.isArray(linkData?.documents)
              ? linkData.documents.map((d: { doc_id: string }) => d.doc_id)
              : [];
            set({ attachedIds: ids });
          } else {
            set({ attachedIds: [] });
          }
        } catch (err) {
          console.error("attached documents load failed", err);
          set({ attachedIds: [] });
        }
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
      // Invalidate first: a late abort or buffered event from the dying
      // stream fails the generation check and writes nothing.
      streamGen[id] = (streamGen[id] ?? 0) + 1;
      streamControllers[id]?.abort();
      delete streamControllers[id];
      set((s) => {
        const buffers = { ...s.buffers };
        delete buffers[id];
        const busy = { ...s.busy };
        delete busy[id];
        return {
          buffers,
          busy,
          conversations: s.conversations.filter((c) => c.id !== id),
          ...(s.activeId === id
            ? {
                activeId: null,
                messages: [],
                pending: false,
                sidebarOpen: false,
                sidebarCitations: [],
                attachedIds: [],
              }
            : {}),
        };
      });
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
      // Only the visible chat blocks sending; other conversations may keep
      // streaming in the background.
      if (!q || get().busy[get().activeId ?? ""] || get().historyLoading) return;
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
            const newId = data.conversation.id as string;
            set((s) => ({
              activeId: newId,
              conversations: [data.conversation, ...s.conversations],
            }));
            // Attachments made before the conversation existed link now.
            for (const docId of get().attachedIds) {
              try {
                await fetch(`/api/conversations/${newId}/documents`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ document_id: docId }),
                });
              } catch (err) {
                console.error("document attach failed", err);
              }
            }
          }
        } catch (err) {
          console.error("conversation create failed", err);
        }
      }
      const conversationId = get().activeId;
      // Creation can fail (offline, 401): without an id there is nowhere
      // to scope the stream, so bail out instead of streaming nowhere.
      if (!conversationId) return;
      const id = get().messages.length + 1;
      const next = [
        ...get().messages,
        { role: "user", text: q },
        { role: "assistant", text: "", citations: [] },
      ] as ChatMessage[];
      set((s) => ({
        failed: false,
        pending: true,
        messages: next,
        buffers: { ...s.buffers, [conversationId]: next },
      }));
      void saveMessage(conversationId, { role: "user", content: q });
      await runAssistant(q, id, conversationId);
    },

    stop: () => {
      const activeId = get().activeId;
      if (activeId) streamControllers[activeId]?.abort();
    },

    regenerate: async () => {
      const msgs = get().messages;
      const activeId = get().activeId;
      if (!activeId || get().busy[activeId] || msgs.length === 0) return;
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
      const next = [
        ...msgs.slice(0, userIdx + 1),
        { role: "assistant", text: "", citations: [] },
      ] as ChatMessage[];
      set((s) => ({
        failed: false,
        pending: true,
        messages: next,
        buffers: { ...s.buffers, [activeId]: next },
      }));
      // The question is already saved; only the fresh answer persists.
      await runAssistant(q, assistantId, activeId);
    },
  };
});
