/** Chat transport: the single seam between the UI and the answer API.
 *
 * Interface: `streamChat(question)` yields typed events and throws
 * `ChatStreamError` on any failure. Everything else — endpoint, SSE
 * framing, JSON shapes, timeout behavior — is implementation detail
 * hidden behind this module.
 */

import type { Citation } from "./types";

export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "meta"; citations: Citation[]; model?: string }
  | { type: "done"; answer: string; citations: Citation[]; model?: string };

export class ChatStreamError extends Error {}

interface RawEvent {
  name: string;
  data: string;
}

function parseSse(buffer: string): { events: RawEvent[]; rest: string } {
  const events: RawEvent[] = [];
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const name = block.match(/^event: (.+)$/m)?.[1].trim() ?? "";
    const data = block.match(/^data: ([\s\S]+)$/m)?.[1] ?? "";
    if (name) events.push({ name, data });
  }
  return { events, rest };
}

export interface StreamOptions {
  /** Silence allowed before the first token (reasoning happens here). */
  initialGraceMs?: number;
  /** Max silence between events once tokens flow. */
  idleMs?: number;
}

const DEFAULT_GRACE_MS = 150_000;
const DEFAULT_IDLE_MS = 45_000;

/** Read one chunk, rejecting if nothing arrives within `ms`. */
function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ChatStreamError("stream stalled")), ms);
  });
  return Promise.race([reader.read().finally(() => clearTimeout(timer)), timeout]);
}

export async function* streamChat(
  question: string,
  opts: StreamOptions = {},
): AsyncGenerator<ChatEvent> {
  const initialGraceMs = opts.initialGraceMs ?? DEFAULT_GRACE_MS;
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
  } catch {
    throw new ChatStreamError("answer service unreachable");
  }
  if (!res.ok || !res.body) throw new ChatStreamError(`bad upstream: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let gotToken = false;
  try {
    for (;;) {
      // Silence, not slowness, is the failure: generation may legitimately
      // take minutes, but a healthy stream never goes quiet mid-flow.
      const { done, value } = await readWithTimeout(
        reader,
        gotToken ? idleMs : initialGraceMs,
      );
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSse(buffer);
      buffer = parsed.rest;
      for (const ev of parsed.events) {
        if (ev.name === "token") {
          gotToken = true;
          yield { type: "token", text: (JSON.parse(ev.data) as { t: string }).t };
        } else if (ev.name === "meta" || ev.name === "done") {
          const data = JSON.parse(ev.data) as {
            answer?: string;
            citations?: Citation[];
            model?: string;
          };
          yield {
            type: ev.name,
            answer: data.answer ?? "",
            citations: data.citations ?? [],
            model: data.model,
          };
        } else if (ev.name === "error") {
          throw new ChatStreamError("upstream error event");
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Already closed or errored; nothing to cancel.
    }
    reader.releaseLock();
  }
}
