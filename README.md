# ollama-chat

A React/Vite chat UI for a homelab [Ollama](https://ollama.com) instance, with a tiny
Express backend for opt-in server-side session sync. Built for one person, one Ollama
server, zero accounts.

## Features

- **Streaming chat**, rendered as Markdown (GitHub-flavored) as the model replies.
- **Multiple conversations** with history, auto-titling from the first message, rename-free
  editing of any message (editing a user message regenerates the reply that followed it).
- **Image attachments** — attach one or more images to a message via the paperclip button.
  There's no model picker: the app is a single fixed **"Chat"** mode that automatically
  routes text-only messages to a text model and anything with an image to a vision model
  (see [ADR-0009](./docs/adr/0009-fixed-chat-mode-automatic-model-routing.md)).
- **Light / dark / system theme**, overridable per profile.
- **Vocal mode** — dictate messages via the microphone (self-hosted Whisper transcription)
  and hear replies read aloud (self-hosted Piper synthesis), switched from the header dropdown
  ([ADR-0011](./docs/adr/0011-server-side-stt-tts-whisper-piper.md)). Requires HTTPS — mic
  access needs a secure context, available on either URL above
  ([ADR-0012](./docs/adr/0012-self-signed-tls-for-secure-context.md)).
- **Optional server-side sync** of conversations/profile/theme, off by default — the app is
  fully usable with `localStorage` alone and no backend running
  ([ADR-0001](./docs/adr/0001-local-first-storage-with-opt-in-sync.md)).
- **No accounts** — a single implicit local profile, matching the actual single-user usage
  ([ADR-0003](./docs/adr/0003-no-authentication-single-implicit-profile.md)).

## How it works

```
Browser ──/api/*──> Ollama (chat, streamed, no app backend in the path)
        └─/session─> Express (opt-in session sync only, server/index.js)
```

For the full picture with diagrams — request flow, model routing, sync, deployment
pipeline, and the production runtime topology — see
[`docs/architecture.md`](./docs/architecture.md).

Chat requests go straight from the browser to Ollama — in dev via Vite's proxy, in
production via the Express server's own proxy middleware
([ADR-0005](./docs/adr/0005-direct-vite-proxy-to-ollama.md)). The Express server otherwise
only exists to persist the optional sync blob to `server/data/session.json`
([ADR-0002](./docs/adr/0002-file-based-json-session-store.md)).

Model choice is fully automatic — `pickModel()` in `src/lib/conversations.js` picks
`qwen2.5vl:3b` when a message carries images, `llama3.1:8b-instruct-q4_0` otherwise. Update
those two constants if the models available on your Ollama instance differ.

## Getting started

**Requirements:** Node 22 (same version the Docker image uses) and a reachable Ollama
instance with at least one model pulled.

```
npm install
```

Point Vite's dev proxy at your Ollama host — edit the `target` in `vite.config.js`'s
`server.proxy['/api']` (defaults to a homelab IP, `192.168.1.241:11434`).

```
npm run dev       # frontend only, proxies /api to Ollama — no backend needed to chat
npm run dev:all   # frontend + session-sync backend (needed to exercise "Sauvegarder sur le serveur")
npm test          # vitest: unit (src/lib) + React integration (src/App.test.jsx) + server e2e (server/index.e2e.test.js)
npm run lint      # oxlint
npm run build     # production build to dist/
npm run preview   # preview the production build locally
```

## Project layout

| Path | What's there |
|---|---|
| `src/App.jsx` | The whole UI — conversation list, message stream, input bar, profile menu |
| `src/lib/conversations.js` | Pure, unit-tested helpers: storage keys, model routing (`pickModel`), Ollama payload shaping (`toOllamaMessage`), conversation/title helpers |
| `server/index.js` | Express: proxies `/api/*` to Ollama, serves `dist/` in production, persists `/session` |
| `server/index.e2e.test.js` | Real app + fake Ollama/Whisper/Piper backends — proxy routing, Origin rewrite, `/session` persistence (see [ADR-0017](./docs/adr/0017-e2e-tests-for-the-express-proxy-server.md)) |
| `k8s/` | Kustomize manifests (Deployment, Service, Ingress, PVC) for the in-cluster deployment |
| `docs/adr/` | Architecture Decision Records — the "why" behind every non-obvious choice in this repo |

## Deployment

Runs on the homelab microk8s cluster via ArgoCD, managed from
[`koydas/gitops-homelab`](https://github.com/koydas/gitops-homelab)
(`apps/ollama-chat/application.yaml`), which points at this repo's `k8s/` directory as its
source ([ADR-0006](./docs/adr/0006-gitops-deployment-via-ghcr.md)).

On every push to `main` (that isn't docs-only), `.github/workflows/docker-publish.yml`
builds the image, pushes it to `ghcr.io/koydas/ollama-chat:<sha>`, and commits the new tag
into `k8s/deployment.yaml` — that commit is what ArgoCD syncs on.

Reachable at:
- **https://192.168.1.244** — dedicated MetalLB IP, works with no client-side setup
  ([ADR-0007](./docs/adr/0007-dedicated-metallb-ip.md)), including on phones that can't add a
  custom hosts entry. Self-signed cert, TLS terminated by the app itself.
- **https://ollama-chat.home** — via the shared `ingress-nginx` at `192.168.1.243`, needs a
  `/etc/hosts` entry pointing at it. Self-signed cert, TLS terminated by `ingress-nginx`.

Both paths use the same self-signed certificate (click through the browser's "not private"
warning once per device) — needed because `getUserMedia` (vocal mode's mic input) requires a
secure context, which plain HTTP doesn't satisfy
([ADR-0012](./docs/adr/0012-self-signed-tls-for-secure-context.md)). On a fresh server this
`ollama-chat-tls` Secret doesn't exist yet and must be created by hand — see
["Bootstrapping a new server"](./docs/architecture.md#bootstrapping-a-new-server-the-tls-secret-and-etchosts-entry)
in `docs/architecture.md` for the exact `openssl`/`kubectl create secret tls` commands and the
required `/etc/hosts` line.

## Architecture decisions

Every non-obvious design choice in this repo — and the trade-offs that came with it — is
written up in [`docs/adr/`](./docs/adr/README.md). Worth skimming before making a change
that touches storage, auth, theming, the chat proxy, model routing, or deployment: there's a
good chance the "obvious" alternative was already considered and rejected there.
