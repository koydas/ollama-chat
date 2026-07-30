# ADR-0015: Downscale Image Attachments Client-Side Before Storing or Sending

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

Live incident, 2026-07-30, right after [ADR-0009](./0009-fixed-chat-mode-automatic-model-routing.md)'s
vision routing and gitops-homelab's [ADR-0019](https://github.com/koydas/gitops-homelab/blob/main/docs/adr/0019-ollama-max-loaded-models-one.md)
(fixing a separate GPU OOM crash): a user attached a real camera photo in Chat mode. Two
distinct problems surfaced from the same root cause — full-resolution images with no size
limit:

1. **Server-side `400`**: the photo's encoded image tokens (4103) exceeded the vision model's
   fixed context window (4096) — `llama-server`'s own log: `request (4103 tokens) exceeds the
   available context size (4096 tokens)`. Clean, fast (~5s), not a crash.
2. **Client-side freeze**: `App.jsx` stores attachments as full data URLs
   ([ADR-0008](./0008-image-attachments-as-data-urls.md)) and re-serializes the *entire*
   conversations array to `localStorage` on every state change (`useEffect` keyed on
   `conversations`, no debounce, no size guard). A multi-MB base64 photo makes that a
   synchronous multi-MB `JSON.stringify` + `localStorage.setItem` on the main thread — either
   stalling the tab for a noticeable stretch, or (if it exceeds the browser's ~5-10MB/origin
   quota) throwing `QuotaExceededError` uncaught, with no error boundary anywhere in this app
   to stop that from crashing the whole React tree to a blank, unresponsive page. That matches
   what the operator actually saw: the app appeared "frozen," not an error banner.

## Decision

`handleAttachFiles` (`src/App.jsx`) now runs every attached image through
`resizeImageDataUrl()` (new, in `src/lib/conversations.js`) before it ever reaches component
state: decodes via `Image`, downscales to fit within 1024px on the long edge if larger,
re-encodes as JPEG at quality 0.8 via an offscreen `<canvas>`. Falls back to the original data
URL — never blocks the attachment — if decoding fails or doesn't finish within 1.5s, so a
format `Image` can't decode (or, per this repo's own `App.test.jsx`, an environment with no
real image decoder like jsdom) degrades gracefully instead of hanging forever.

Also added, as defense-in-depth rather than the primary fix: the `conversations` `localStorage`
write in `App.jsx` is now wrapped in `try/catch`, surfacing any future write failure as a
visible error banner instead of an uncaught crash.

## Alternatives Considered

### Only add the try/catch safety net, leave images full-resolution
Rejected as insufficient on its own: fixes the crash-to-blank-page failure mode but does
nothing about the `400` from exceeding the model's context window, and a large image would
still stall the tab on every conversation update even without throwing.

### Resize only for the outgoing Ollama request, keep full-resolution in stored/displayed state
Rejected: the `localStorage` stall/crash risk comes from what's *stored*, not from what's sent
over the wire — resizing only at request time would fix the `400` but leave the freeze bug
completely unaddressed. Downscaling once, before the data URL ever enters state, fixes both
with one change and one copy of the image kept around, instead of two.

### Reject oversized images with an error instead of resizing
Rejected: strictly worse UX for a chat app whose whole point is "attach a photo, ask about it"
— resizing preserves the feature; rejecting removes it for the exact case (a normal camera
photo) users will hit by default.

## Consequences

- ✅ Fixes both symptoms of the 2026-07-30 incident from a single change: smaller images fit
  comfortably within the vision model's 4096-token context, and no longer risk a multi-MB
  synchronous `localStorage` write.
- ✅ No server/backend change needed — purely client-side, before the data URL is ever stored
  or sent.
- ✅ Defense-in-depth: the `try/catch` around the `conversations` write means any *other* future
  cause of a large/failing write surfaces as an error banner, not a silent crash to blank page.
- ⚠️ Attached images are now visibly lower-resolution/quality (JPEG re-encode, 1024px cap) than
  what the user picked — acceptable for a chat/vision-Q&A tool, not for a photo-archival one.
- ⚠️ 1024px / quality 0.8 are not derived from a formal sweep of the vision model's actual
  token-per-pixel behavior — chosen as a conservative value comfortably under the incident's
  4103-token failure and the model's documented `image_max_pixels: 3211264` (Ollama's own
  Modelfile default for `qwen2.5vl:3b`). Revisit with real measurements if a future image still
  overflows the context window.

## Follow-up (same day)

This fix only shrinks *newly*-attached images. The operator's browser still had the original
full-resolution photo from the incident stored in `localStorage` from before this fix existed,
and it alone was large enough to push every subsequent save over the browser's quota — visible
as `Error: could not save conversation locally (the quota has been exceeded)` on effectively
every future state change, since the `try/catch` from this same ADR was working as intended
(no crash) but had nothing to actually recover with.

Added `stripImages()` (`src/lib/conversations.js`): on a `localStorage` write failure, drop
embedded image data from every message (by far the largest contributor) and retry once,
updating React state to match so the stripped result — not the original oversized one — is
what future saves are based on. Loses old image thumbnails on reload but keeps all text intact,
and self-heals without requiring the operator to manually clear browser storage. Surfaces as an
info-style message via the same `error` banner rather than a new UI element.

Per operator request: a stripped message's content now gets `[Image]` appended (or set to it
outright, if there was no text) instead of just silently losing the image with no trace — the
message stays visible in history with a marker showing a photo used to be attached there,
rather than reading like the user only ever sent bare text.
