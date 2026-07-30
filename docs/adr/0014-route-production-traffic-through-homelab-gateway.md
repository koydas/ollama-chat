# ADR-0014: Route production backend calls through homelab-gateway

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

`server/index.js` has always proxied production `/api` (Ollama), `/api/stt` (Whisper), and
`/api/tts` (Piper) calls straight to each backend's in-cluster Service DNS name (ADR-0005,
ADR-0011). A separate app, `homelab-gateway` (`github.com/koydas/homelab-gateway`, deployed
via `gitops-homelab/apps/homelab-gateway`), already exists as a single LAN entry point in
front of these same three backends, doing content-based routing and exporting Prometheus
metrics (`gateway_http_requests_total`, `gateway_ollama_model_requests_total{model}`, etc.).
It was built independently of `ollama-chat` and, until now, nothing routed through it — the
operator wants visibility into `ollama-chat`'s own call volume/latency/model usage, which
only exists if its traffic actually passes through the gateway.

## Decision

`k8s/deployment.yaml` now points `OLLAMA_URL`, `WHISPER_URL`, and `PIPER_URL` at
`http://homelab-gateway.homelab-gateway.svc.cluster.local:80` instead of each backend's own
Service. No changes were needed in `server/index.js` itself: its three proxies already send
requests to paths (`/asr`, `/tts`, original `/api/*` paths) that line up exactly with the
gateway's content-sniffing routing rules (audio/multipart → Whisper `/asr`, JSON `text` →
Piper `/tts`, JSON `model` or bodiless → Ollama, path preserved), so the gateway forwards
each one to the correct backend transparently.

This surfaced a real bug that had to be fixed in `homelab-gateway` itself first: Ollama
enforces an Origin allowlist (DNS-rebinding protection, see ADR-0005) and its own
`changeOrigin: true` proxy option only rewrites the `Host` header, not `Origin`. Verified
empirically (`curl` with a mismatched `Origin` against the live `ollama` Service returned
403) — without a fix, chaining through the gateway would have silently 403'd every chat
request. `homelab-gateway/server/index.js`'s `ollamaProxy` now explicitly sets
`Origin: OLLAMA_URL` before forwarding, the same rewrite `ollama-chat` already did for its
own (now bypassed) direct-to-Ollama proxy.

## Alternatives Considered

- **Leave `ollama-chat` calling backends directly, add a second metrics path in
  `homelab-gateway` some other way** — rejected: `homelab-gateway` already does exactly this
  job (content-based routing + Prometheus counters/histograms per backend); duplicating that
  logic in `ollama-chat` instead of reusing the existing service would be pure duplication.
- **Route only Ollama through the gateway, leave Whisper/Piper direct** — rejected: the
  gateway fronts all three backends by design and the path/content-sniffing already lines up
  for STT/TTS too, so there's no cost to routing everything through it, and it keeps a single
  place to look at total call volume across chat + vocal mode.

## Consequences

- ✅ `ollama-chat`'s chat, STT, and TTS calls are now all visible in `homelab-gateway`'s
  Prometheus metrics (per-backend request/latency counters, per-model Ollama counter).
- ✅ No code change needed in this repo's proxy logic — only the three env var values in
  `k8s/deployment.yaml` changed.
- ⚠️ Adds an extra network hop (ollama-chat → gateway → backend) to every chat/STT/TTS call;
  negligible on the LAN but worth knowing if latency is ever investigated.
- ⚠️ `ollama-chat` now has a runtime dependency on `homelab-gateway` being healthy, in
  addition to Ollama/Whisper/Piper themselves — if the gateway pod is down, chat and vocal
  mode both fail even though the backends are fine. Same shape of new dependency ADR-0011
  already introduced for Whisper/Piper.
- Neutral: ADR-0005's "direct... no chat backend" framing was specifically about *dev-mode*
  Vite proxying straight to Ollama's LAN IP — `vite.config.js` is unchanged and still bypasses
  the gateway in local dev; this ADR only affects the production Express path.
