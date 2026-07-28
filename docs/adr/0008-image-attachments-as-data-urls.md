# ADR-0008: Image attachments stored as data URLs, converted to bare base64 at the Ollama boundary

- **Date:** 2026-07-28
- **Status:** Accepted

## Context

The operator wanted to send images in chat messages so a vision-capable model could
describe/analyze them. Ollama's `/api/chat` expects each message's `images` field as an
array of bare base64 strings (no `data:` prefix). The UI, however, needs something it can
put directly into an `<img src>` to render thumbnails and message attachments — a bare
base64 string alone is not enough, it also needs a MIME type.

## Decision

Attached images are read client-side via `FileReader.readAsDataURL` and stored as full data
URLs (`data:image/png;base64,...`) on the message object itself (`message.images: [dataUrl,
...]`) — the same shape that's already persisted to `localStorage` and synced to
`server/data/session.json` (ADR-0001/0002). This makes rendering trivial: `<img
src={dataUrl}>` needs no extra bookkeeping.

The Ollama-specific bare-base64 format is produced at a single conversion point,
`toOllamaMessage()` in `src/lib/conversations.js`, called only when building the `/api/chat`
request body. It strips everything up to and including the last comma
(`dataUrl.split(',').pop()`), so the data-URL/MIME-type detail never leaks past that one
function.

Editing a message preserves its `images` field (the edit handler now spreads the original
message and only overwrites `content`), so re-editing text on an image message doesn't drop
the attachment. The Express session-sync body limit (`server/index.js`) was raised from
5mb to 25mb to fit synced conversations that include encoded images.

## Alternatives Considered

- **Store bare base64, prepend `data:image/...;base64,` at render time** — rejected: every
  render call site would need to know (or guess) the MIME type; centralizing the prefix
  strip on the outbound side is strictly less code than centralizing a re-add on every
  inbound render.
- **Upload images to a separate endpoint/object store, reference by URL** — rejected for the
  same reason ADR-0002 rejected a database: single-user homelab tool, no existing storage
  infra, and the whole-blob JSON session store already matches this shape.

## Consequences

- ✅ Rendering an attached image anywhere in the UI (pending-attachment strip, sent message
  bubble) is a plain `<img src={dataUrl}>` — zero extra plumbing.
- ✅ The Ollama wire format is produced in one pure, tested function
  (`toOllamaMessage`), not scattered across call sites.
- ⚠️ Base64 inflates both `localStorage` and `server/data/session.json` — ADR-0002 already
  flagged the whole-file JSON store as not scaling to large history; a few image-heavy
  conversations make that worse and could hit the browser's `localStorage` quota
  (typically 5-10MB) sooner than plain-text history would.
- ⚠️ No client-side image compression/resizing before encoding — a full-resolution phone
  photo is sent (and stored) as-is, which can be several MB per attachment.
