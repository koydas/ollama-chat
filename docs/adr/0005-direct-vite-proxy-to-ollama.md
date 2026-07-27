# ADR-0005: Direct Vite proxy to Ollama for chat (no chat backend)

- **Date:** 2026-07-27
- **Status:** Accepted

## Context

The app needs to call Ollama's HTTP API (`/api/tags`, `/api/chat`) from the browser.
Ollama runs on a separate host on the homelab network and enforces an Origin allowlist
(DNS-rebinding protection).

## Decision

Vite's dev server proxies `/api/*` straight to the Ollama host
(`http://192.168.1.241:11434`), rewriting the `Origin` header to satisfy Ollama's
allowlist check. There is no application backend in the chat request path — the
browser streams the response directly from Ollama through the proxy. This is kept
deliberately separate from the `/session` sync backend (ADR-0001), which is a
distinct Express process on its own port.

## Alternatives Considered

- **Routing chat through the Express sync backend** — rejected: would add a hop and a
  second thing to keep running just to relay bytes Ollama already streams correctly,
  and would conflate two unrelated concerns (chat proxying vs. session persistence).

## Consequences

- ✅ Simplest possible chat path — one less process required to just chat with a model.
- ✅ Keeps the sync backend optional and independent: chat works with `npm run dev`
  alone, sync needs `npm run dev:all`.
- ⚠️ Production builds (`vite build` → static `dist/`) have no equivalent proxy —
  deploying the built app requires a reverse proxy (or similar) in front of Ollama;
  this isn't set up yet.
- ⚠️ The hardcoded Ollama target IP (`192.168.1.241`) in `vite.config.js` is dev-only
  convenience — no env-based override exists yet.
