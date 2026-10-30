# Background generation: the streaming concurrency problem

## The problem

Streaming used to be global: one `streamAbort` controller, one `pending`
flag, and answers written by array index into a single `messages` array.
Anything that replaced that array mid-stream orphaned the writes:

- New chat wiped `messages` while the old answer still streamed. Later
  tokens landed in the new empty array by index and vanished, so the
  visible response "stopped" for no reason.
- Delete chat had the same hole, and the orphaned stream could still call
  `saveMessage` for a deleted conversation.
- Open chat refused silently while `pending`, so the click looked dead.
- `stop` fired abort and returned; buffered events could still land after
  the click, and the `finally` block always cleared `pending`, so a stale
  stream finishing late reopened the send gate for a newer run and allowed
  two overlapping streams. Only the newest stayed stoppable.

## The solution (ChatGPT-style)

Streams are scoped per conversation instead of globally:

- `buffers: Record<conversationId, ChatMessage[]>` holds every live
  conversation's messages. `messages` is only the mirror of the active
  one: each event patches the buffer, and the view updates only when its
  conversation is active.
- `busy: Record<conversationId, boolean>` marks live streams. `pending`
  now means "the visible chat is streaming" and is synced on every
  transition, so existing UI gating (send, stop, regenerate) works
  unchanged.
- One `AbortController` per conversation, plus a generation token per
  conversation. Deletes and new runs bump the token first; late events
  from a superseded run fail the check and write nothing, save nothing,
  and clear nothing. This covers stop-then-send and delete-mid-stream
  without awaiting anything.
- Navigation is never blocked. New chat only clears the view. Opening a
  chat prefers its live buffer over a server fetch (the server copy lacks
  the in-flight partial answer) and falls back to fetching otherwise.
  Stop aborts only the visible conversation's stream.
- Errors stay local: a background failure never raises the error banner
  on the chat you are looking at.
- The history rail shows a pulsing dot on conversations that are still
  answering, and every button that used to freeze mid-stream (history
  items, new chat) stays clickable.

`web/stores/chat-store.ts` owns all of this; components only render.
The concurrency spec (`bg.spec.mjs`) drives two overlapping mocked
streams and asserts switching neither stops nor mixes them.
