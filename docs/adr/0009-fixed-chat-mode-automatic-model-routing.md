# ADR-0009: Fixed "Chat" mode with automatic model routing, no model picker

- **Date:** 2026-07-28
- **Status:** Accepted

## Context

Adding image support (ADR-0008) meant the server now hosts two models the operator actually
uses: `llama3.1:8b-instruct-q4_0` for text and `qwen2.5vl:3b` for messages with images.
The existing header `<select>` (populated from `/api/tags`) required manually picking the
right model before every message, and picking wrong either wasted a model load/swap on the
GPU or sent an image to a model that can't read it. For a single-user tool, the operator
explicitly asked to remove that decision entirely rather than manage a dropdown.

## Decision

The model `<select>` is removed from the header and replaced with a static, non-interactive
`"Chat"` label (`.chat-badge`). Model choice moves out of the UI and into a pure function,
`pickModel(messages)` (`src/lib/conversations.js`), alongside two fixed constants:

```js
export const TEXT_MODEL = 'llama3.1:8b-instruct-q4_0'
export const VISION_MODEL = 'qwen2.5vl:3b'

export function pickModel(messages) {
  return messages.some((m) => m.images && m.images.length > 0) ? VISION_MODEL : TEXT_MODEL
}
```

`streamReply` calls `pickModel(messagesForModel)` on every request instead of reading a
stored `selectedModel`. The per-conversation `model` field, `MODEL_STORAGE_KEY` and
`loadStoredModel()` are removed along with the dropdown — there is nothing left to persist.
`/api/tags` is still fetched once at startup, now purely to confirm Ollama is reachable (the
existing "Could not reach Ollama" error banner), not to populate a model list.

## Alternatives Considered

- **Keep the dropdown, auto-select the right model in it** — rejected: still a selectable
  control, which contradicts "no dropdown to play with," and `/api/tags` doesn't expose a
  vision-capability flag, so filtering it correctly would need the same hardcoded
  capability map this decision already needs — without removing the UI friction.
- **Collapse to one model for everything** (drop `llama3.1:8b-instruct-q4_0`, use
  `qwen2.5vl:3b` for text too) — rejected: `qwen2.5vl:3b` is a lighter vision-tuned model;
  `llama3.1:8b-instruct-q4_0` is the stronger pure-text conversational model already in
  production use. Two fixed, purpose-matched models beat one compromise model.

## Consequences

- ✅ Zero model decisions for the operator — attach an image or don't, the right model runs
  automatically, every time.
- ✅ Routing logic is one small, directly unit-tested pure function
  (`pickModel`), not UI state.
- ⚠️ Model tags are hardcoded in source. If either `llama3.1:8b-instruct-q4_0` or
  `qwen2.5vl:3b` is ever removed or re-tagged on the server (e.g. a future re-quantization),
  chat breaks with an Ollama 404 until the constants in `conversations.js` are updated —
  there's no runtime check that the models actually exist.
- ⚠️ Model choice is per-request, not per-conversation: a single thread that mixes image and
  text-only turns silently alternates between the two models turn-by-turn, with no
  indication of that in the UI.
