# ADR-0018: Add a "Claude" chat mode alongside Chat and Vocal

- **Date:** 2026-07-31
- **Status:** Accepted

## Context

Both existing modes (`text`, `vocal`) route through the same fixed-model-per-shape Ollama
pipeline (ADR-0009). Wanting a real Claude model available in the same UI meant adding a third
backend this app can talk to — Anthropic's Messages API, an entirely different request/response
shape from Ollama's `/api/chat`.

## Decision

A third `<option value="claude">` in the existing mode `<select>` (`src/App.jsx`), sharing the
`voiceMode` state variable — renamed `chatMode` (`CHAT_MODE_KEY`/`loadChatMode` in
`src/lib/conversations.js`) since it now holds a value with nothing to do with voice. The
underlying `localStorage` key value is **not** renamed (`ollama-chat-voice-mode` stays as-is)
so an existing user's stored mode preference isn't silently reset by this refactor.

- **`toClaudeMessage()`** (`src/lib/conversations.js`), parallel to `toOllamaMessage()`:
  converts the app's message shape into Anthropic content blocks (image blocks, parsed
  media type off the stored data-URL prefix, then a text block — omitted when there's no
  text, since Claude rejects an empty one). No separate vision-model routing like
  `pickModel()` needs for Ollama — Claude is natively multimodal, one model handles both.
- **`CLAUDE_MODEL = 'claude-opus-5'`** — a single constant, not configurable in the UI, same
  posture as `TEXT_MODEL`/`VISION_MODEL` (ADR-0009).
- **`POST /api/claude-chat`** (`server/index.js`), registered before the generic `/api` proxy
  the same way `/api/stt`/`/api/tts` already are. Unlike those, it isn't a passthrough: it
  calls Anthropic via `@anthropic-ai/sdk`'s `messages.stream()` and re-emits each text delta as
  `{"message":{"content":"..."}}\n` — **the exact NDJSON shape Ollama's own streaming response
  already uses**. This means `streamReply()` in `App.jsx` needs no per-provider parsing branch;
  only the request-building branches on `chatMode === 'claude'`.
- **`CLAUDE_URL`** env var, unset by default (SDK falls back to `api.anthropic.com` directly —
  convenient for local dev), overridden in `k8s/deployment.yaml` to `homelab-gateway`, the same
  as `OLLAMA_URL`/`WHISPER_URL`/`PIPER_URL` — see `homelab-gateway`'s ADR-0003 for why routing
  through there instead of straight to Anthropic. This app still owns the actual
  `ANTHROPIC_API_KEY` credential and sends it on every request; the gateway only relays it.
- **`ANTHROPIC_API_KEY`** is a Secret created once out-of-band (never in Git) — same posture as
  `ollama-chat-tls` (ADR-0012); see `docs/deployment.md`'s bootstrapping section for the exact
  command. The route returns `500` without ever calling out if the key isn't configured, rather
  than letting the SDK fail in a less obvious way.
- Vite's dev proxy (`vite.config.js`) gets a `/api/claude-chat` entry pointed at the local
  Express server (`:3001`, same target as `/session`), since — unlike Ollama/Whisper/Piper —
  there's no LAN service to hit directly; the credential and translation logic only exist in
  this app's own server.

## Alternatives Considered

- **A separate parsing path in the frontend for Claude's SSE stream** — rejected: normalizing
  server-side to Ollama's NDJSON shape means `streamReply()`'s response-reading loop is
  entirely unchanged, at the cost of one small server-side translation function instead of a
  second client-side one.
- **Renaming the `ollama-chat-voice-mode` localStorage key itself** — rejected: would silently
  reset every existing user's (i.e. the one user's) saved mode preference for a purely cosmetic
  rename; the exported JS identifier is what actually needed to stop lying about what it holds.
- **A model picker instead of a fixed `CLAUDE_MODEL` constant** — rejected: consistent with
  ADR-0009's reasoning for Ollama — this is a single-user app, and a picker is one more piece
  of UI to maintain for a choice that's already made once in code.
- **Have this app call `api.anthropic.com` directly, no gateway involvement** — rejected in
  favor of `homelab-gateway`'s ADR-0003: unified request volume/latency/model-usage visibility
  across every backend this app talks to was the explicit point of routing through the gateway
  in the first place (ADR-0014), and a fourth backend invisible to that same `/metrics` and
  call log would defeat it.

## Consequences

**Good:**
- Adding a real hosted model required exactly one new server route, one new pure function, and
  a handful of lines in `App.jsx` — the existing streaming/error/history/edit machinery is
  entirely unaware there's now a second backend.
- Claude mode's traffic gets the same observability (Prometheus metrics, Mongo call log) as
  Ollama/Whisper/Piper, via `homelab-gateway`.

**Neutral:**
- `chatMode === 'claude'` deliberately doesn't show the mic button (`showMicButton` still only
  checks `=== 'vocal'`) — voice input/output and "which model answers" are orthogonal axes that
  happen to share one dropdown for now. If a voice+Claude combination is ever wanted, this
  single `<select>` stops being sufficient and would need to become two independent toggles.

**Negative:**
- ⚠️ No token-usage/cost visibility into Claude calls yet — `server/index.js` uses the SDK's
  `messages.stream()` and only reads `content_block_delta` events; the final `message_delta`
  event's `usage` field (and Anthropic's own timing) is available but currently discarded. If
  cost tracking becomes a real need, `homelab-gateway`'s ADR-0003 already flags this as a
  likely follow-up on the gateway side instead.
- ⚠️ `CLAUDE_MAX_TOKENS = 8192` is a hard cap on thinking + response tokens combined (Claude
  Opus 5 runs adaptive thinking by default) — a chosen-generous-but-arbitrary constant, not
  measured against real usage. A genuinely hard question could still get truncated mid-thought
  before producing visible text; no test covers that edge case.
