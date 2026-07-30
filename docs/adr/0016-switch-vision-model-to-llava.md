# ADR-0016: Switch the vision model to `llava:7b`

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

Live conversation, 2026-07-30: with `qwen2.5vl:3b` as `VISION_MODEL` ([ADR-0009](./0009-fixed-chat-mode-automatic-model-routing.md)),
the operator attached 3 images in one Chat-mode conversation, got correct answers about them,
then asked a text-only follow-up question referring back to the images — the model replied it
couldn't read images.

Checked the actual Ollama logs for that exact exchange rather than guessing: the follow-up
request's cached-token count (3309) was nearly identical to its total token count (3323), and
`n_ctx_slot = 4096` was never exceeded — no context-shift/truncation occurred, the encoded
image data from all 3 prior turns was still genuinely present in the model's context window
when it claimed otherwise. That rules out an infrastructure/truncation cause and points at
`qwen2.5vl:3b` itself: a 3B-parameter vision-language model is small, and small VLMs are known
to be unreliable at maintaining cross-turn visual grounding, especially across multiple images
in one conversation — this looks like a model-capability limitation, not a bug.

`llava:7b` was already present on the server (`ollama list`, pulled out-of-band previously,
unused by any current app) — a larger, more established vision-language model, well regarded
for exactly this kind of multi-turn image Q&A.

## Decision

`VISION_MODEL` in `src/lib/conversations.js` changes from `qwen2.5vl:3b` to `llava:7b`.
`TEXT_MODEL` (`llama3.1:8b-instruct-q4_0`) is unchanged — this only affects messages that carry
images. `pickModel()`'s logic itself is untouched, still just switches on whether any message in
the array has a non-empty `images` field.

## Alternatives Considered

### Keep `qwen2.5vl:3b`, work around it with prompt engineering (e.g. re-inject image context each turn)
Rejected: treats a model-capability gap as something to route around in application code,
adding complexity for a problem a more capable model already present on the server solves
directly.

### Pull a larger/newer vision model instead of using the already-installed `llava:7b`
Rejected for now: no evidence yet that `llava:7b` itself is insufficient, and it costs nothing
to try what's already on disk before spending bandwidth/time pulling something else.

## Consequences

- ✅ No code path changes needed beyond the one constant — `pickModel()`, the resize pipeline
  (ADR-0015), and the gateway routing (ADR-0014) are all model-agnostic.
- ✅ Reuses a model already present on the server; no pull needed.
- ⚠️ `llava:7b` (7B params) is a noticeably larger model than `qwen2.5vl:3b` (3B) — expect a
  longer load time on a model switch (already unavoidable per [gitops-homelab ADR-0019](https://github.com/koydas/gitops-homelab/blob/main/docs/adr/0019-ollama-max-loaded-models-one.md)'s
  `OLLAMA_MAX_LOADED_MODELS=1`) and evaluate its VRAM footprint alongside Whisper's resident
  ~1.3-1.4GB on the GTX 1060's 6GB before assuming it's a drop-in fit.
- ⚠️ Not yet re-benchmarked against ADR-0015's 1024px/JPEG-quality-0.8 resize choice, which was
  tuned against `qwen2.5vl:3b`'s specific token-per-image behavior — `llava`'s own image
  tokenization may cost a different number of tokens per image against the same `n_ctx` budget.
  Revisit those constants if a `llava:7b` request overflows context the way the original
  incident did.
- ⚠️ Multi-image, multi-turn reliability is *expected* to improve based on `llava:7b`'s general
  reputation, not yet confirmed with a repeat of the exact 3-image scenario that surfaced this.
