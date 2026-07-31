# ADR-0019: This app holds no Anthropic credential — homelab-gateway does

- **Date:** 2026-07-31
- **Status:** Accepted

## Context

ADR-0018 had this app own `ANTHROPIC_API_KEY` directly, with `CLAUDE_URL` falling back to
calling `api.anthropic.com` straight when unset. In practice that made a purely additive change
(a new dropdown option) deployment-blocking: the pod went `CreateContainerConfigError` the
moment it shipped, because `k8s/deployment.yaml` referenced an `ollama-chat-anthropic` Secret
that didn't exist yet. This app is always meant to reach Claude through `homelab-gateway` — the
whole point of ADR-0018 routing that way was unified visibility across every backend — so a
direct-to-Anthropic fallback was never actually a real option, just a dead code path that
happened to need its own credential.

## Decision

The credential moves to `homelab-gateway` (that repo's ADR-0004). On this side:

- `server/index.js`: `CLAUDE_URL` now **always** defaults to `homelab-gateway`'s in-cluster DNS
  name — no more "unset → talk to Anthropic directly." The `/api/claude-chat` route no longer
  checks for or reads `ANTHROPIC_API_KEY` at all; it constructs `new Anthropic({apiKey:
  'placeholder-gateway-injects-the-real-key', baseURL: CLAUDE_URL})`. The SDK requires a
  non-empty string to construct — the placeholder exists only to satisfy that, and is
  overwritten by the gateway's own key before the request ever reaches Anthropic (that repo's
  `claudeProxy`). If `CLAUDE_URL` were ever pointed somewhere that *doesn't* do that
  substitution, every call would 401 — deliberately, since this app holding a working
  credential of its own is exactly what this ADR removes.
- `k8s/deployment.yaml`: the `ANTHROPIC_API_KEY` env var and its `secretKeyRef` are gone
  entirely. `CLAUDE_URL` stays explicit (matching `OLLAMA_URL`/`WHISPER_URL`/`PIPER_URL`'s own
  pattern) even though it now equals the code's own default — consistency with the other three
  outweighs the minor redundancy.
- `docs/deployment.md`'s Claude-key bootstrapping section is removed — there's nothing to
  bootstrap here anymore. See `homelab-gateway`'s own `docs/deployment.md` instead.

## Alternatives Considered

Same alternatives ADR-0018 didn't need to weigh, now covered in `homelab-gateway`'s ADR-0004
(keep the Secret here but make it optional; have the gateway inject from scratch instead of
overwriting a placeholder) — not repeated here since the reasoning is identical from this side.

## Consequences

**Good:**
- `ollama-chat` deploys cleanly again with zero Claude-specific Kubernetes configuration to
  create — the Claude dropdown option ships the same way any other UI change would.
- Matches how this app already treats Ollama/Whisper/Piper: no credential for any of them
  either, just a URL pointed at the gateway.

**Negative:**
- ⚠️ `CLAUDE_URL`'s new unconditional default means there's no supported way to run this app's
  Claude mode against real Anthropic directly (e.g. for local debugging outside the cluster)
  without either running a local `homelab-gateway` too or temporarily hacking in a real key —
  every other mode (`text`/`vocal`) has no such constraint. Acceptable for now since local dev
  of Claude mode specifically hasn't come up as a real need.
