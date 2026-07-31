# Claude mode

The header `<select>` (shared with [vocal mode](./vocal-mode.md)) has a third value, `claude`.
Unlike `text`/`vocal` — which are both Ollama under the hood, differing only in dictation/TTS —
`claude` mode routes the actual chat request to Anthropic's API instead
([ADR-0018](./adr/0018-claude-chat-mode.md)).

```mermaid
sequenceDiagram
    participant U as Browser (React app)
    participant P as Express server<br/>(server/index.js)
    participant G as homelab-gateway
    participant A as Anthropic Messages API

    U->>U: toClaudeMessage(messages)<br/>image + text content blocks, no vision-model split
    U->>P: POST /api/claude-chat<br/>{ model: CLAUDE_MODEL, messages, stream: true }
    P->>G: messages.stream() via @anthropic-ai/sdk<br/>(x-api-key: placeholder, this app holds no real key)
    G->>G: overwrite x-api-key with the gateway's own<br/>ANTHROPIC_API_KEY (that repo's ADR-0004)
    G->>A: forwarded, real key attached
    A-->>G-->>P: SSE: content_block_delta events
    P->>P: re-emit each text_delta as<br/>{"message":{"content":"..."}}\n
    P-->>U: NDJSON — same shape /api/chat already streams
    U->>U: append each chunk's content<br/>to the pending assistant message (unchanged code path)
```

`P`'s hop to `A` always passes through `homelab-gateway` (`CLAUDE_URL` has no
direct-to-Anthropic fallback, unlike the original design in ADR-0018) — this app deliberately
holds no working Anthropic credential of its own; see
[ADR-0019](./adr/0019-gateway-owns-anthropic-key.md) and that repo's
[ADR-0004](https://github.com/koydas/homelab-gateway/blob/main/docs/adr/0004-gateway-owns-anthropic-key.md).

## Why the frontend's streaming code needed no changes

`streamReply()` in `App.jsx` branches only on **which request to send** — the URL, the model,
and `toClaudeMessage()` vs `toOllamaMessage()` for building the message payload. The
NDJSON-parsing loop that reads the response and appends deltas to the pending assistant message
is exactly the same code for both providers, because `server/index.js` does the translation
work: it re-emits Anthropic's SSE `content_block_delta` events in the identical
`{"message":{"content":"..."}}\n`-per-line shape Ollama's own `/api/chat` streams. See
[chat-and-images.md](./chat-and-images.md) for that shared parsing loop.

## Images

`toClaudeMessage()` (`src/lib/conversations.js`) builds one `image` content block per
attachment — base64 data plus its real media type, parsed off the stored data URL's
`data:image/...;base64,` prefix (the same storage format described in
[chat-and-images.md](./chat-and-images.md#image-attachments)) — followed by a `text` block,
omitted when the message has no text (Claude rejects an empty one). Unlike Ollama, there's no
separate vision-model routing: Claude Opus 5 is natively multimodal, so `CLAUDE_MODEL` is a
single constant regardless of whether the message carries images.

## What's not wired up yet

- No per-call cost/token-usage tracking — the SDK stream's final `usage` field is available but
  currently discarded. See ADR-0018's Consequences.
- No configurable model — `CLAUDE_MODEL` is a fixed constant, same posture as `TEXT_MODEL`/
  `VISION_MODEL` ([ADR-0009](./adr/0009-fixed-chat-mode-automatic-model-routing.md)).
