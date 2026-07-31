# Architecture

`ollama-chat` is a single-page React app talking to Ollama (and, in Claude mode, Anthropic's
API), plus a small Express process that does three jobs: proxying Ollama chat requests
byte-for-byte in production, translating Claude mode's requests to/from Anthropic's Messages
API shape, and persisting an opt-in session-sync blob. For Ollama, the browser streams tokens
straight through with no application logic in between; Claude mode is the one exception — see
[ADR-0018](./adr/0018-claude-chat-mode.md). See [`docs/adr/`](./adr/README.md) for the
reasoning behind each of these choices.

This page is the map: a component overview and the production runtime topology. Each
subsystem has its own focused page:

- [`chat-and-images.md`](./chat-and-images.md) — sending a message, automatic model routing, image attachments
- [`vocal-mode.md`](./vocal-mode.md) — dictation, TTS playback, the mic/send button state machine
- [`claude-mode.md`](./claude-mode.md) — routing to Anthropic instead of Ollama, why the streaming code didn't need to change
- [`storage-sync.md`](./storage-sync.md) — local-first storage, opt-in server-side sync
- [`deployment.md`](./deployment.md) — CI/CD pipeline, bootstrapping a new server's TLS cert

## Components

| Component | Role | Source |
|---|---|---|
| React/Vite frontend | Conversation UI, message streaming, image attachments, theme/profile, mode selection | `src/App.jsx`, `src/lib/conversations.js` |
| Vite dev proxy | Dev-only: forwards `/api/*` (Ollama/STT/TTS) to their LAN backends, `/api/claude-chat` and `/session` to the local Express server | `vite.config.js` |
| Express server | Prod: serves `dist/`, proxies `/api/*` to Ollama, translates `/api/claude-chat` to/from Anthropic's Messages API, persists `/session` | `server/index.js` |
| homelab-gateway | Single entry point in front of Ollama/Whisper/Piper/Anthropic; routes by request content and exports Prometheus metrics for all four ([ADR-0014](./adr/0014-route-production-traffic-through-homelab-gateway.md), [ADR-0018](./adr/0018-claude-chat-mode.md)) | `github.com/koydas/homelab-gateway`, in-cluster `homelab-gateway` Service |
| Ollama | Runs the actual models; two tags are used: a text model and a vision model | in-cluster `ollama` Service, reached via homelab-gateway |
| Whisper | Speech-to-text for vocal mode dictation, proxied at `/api/stt` | in-cluster `whisper` Service, reached via homelab-gateway |
| Piper | Text-to-speech for vocal mode replies, proxied at `/api/tts` | in-cluster `piper` Service, reached via homelab-gateway |
| Claude (Anthropic API) | Runs `CLAUDE_MODEL` for Claude mode, proxied at `/api/claude-chat` ([ADR-0018](./adr/0018-claude-chat-mode.md)) | `api.anthropic.com`, external — reached via homelab-gateway, which owns the credential ([ADR-0019](./adr/0019-gateway-owns-anthropic-key.md)) |
| ArgoCD + GHCR | Builds, publishes, and deploys the app on every push to `main` | `.github/workflows/docker-publish.yml`, `k8s/` |

## Runtime topology (production)

```mermaid
flowchart TB
    subgraph Client
        Browser
    end
    subgraph "microk8s cluster"
        subgraph "ollama-chat namespace"
            Pod["ollama-chat pod<br/>Express :8080"]
            PVC["ollama-chat-session PVC<br/>(session.json)"]
            Pod --- PVC
        end
        subgraph "homelab-gateway namespace"
            GatewaySvc["homelab-gateway Service<br/>:80, routes by content"]
        end
        subgraph "ollama namespace"
            OllamaSvc["ollama Service<br/>:11434"]
        end
        subgraph "whisper / piper namespaces"
            WhisperSvc["whisper Service<br/>:9000"]
            PiperSvc["piper Service<br/>:8000"]
        end
        SvcLB["Service (LoadBalancer)<br/>192.168.1.244"]
        Ing["ingress-nginx<br/>192.168.1.243<br/>host: ollama-chat.home"]
    end
    Anthropic["api.anthropic.com<br/>(external)"]
    Browser -->|http://192.168.1.244| SvcLB --> Pod
    Browser -->|http://ollama-chat.home| Ing --> Pod
    Pod -->|OLLAMA_URL / WHISPER_URL / PIPER_URL / CLAUDE_URL| GatewaySvc
    GatewaySvc --> OllamaSvc
    GatewaySvc --> WhisperSvc
    GatewaySvc --> PiperSvc
    GatewaySvc --> Anthropic
```

Reachable either via a dedicated MetalLB IP (`.244`, zero client-side setup) or through the
shared ingress at `ollama-chat.home` (`.243`, needs a `/etc/hosts` entry) — see
[ADR-0007](./adr/0007-dedicated-metallb-ip.md).
