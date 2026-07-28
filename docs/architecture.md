# Architecture

`ollama-chat` is a single-page React app talking directly to an Ollama server, plus a small
Express process that does two unrelated jobs: proxying chat requests in production, and
persisting an opt-in session-sync blob. There is deliberately no "chat backend" — the browser
streams tokens straight from Ollama in both dev and prod. See [`docs/adr/`](./adr/README.md)
for the reasoning behind each of these choices.

## Components

| Component | Role | Source |
|---|---|---|
| React/Vite frontend | Conversation UI, message streaming, image attachments, theme/profile | `src/App.jsx`, `src/lib/conversations.js` |
| Vite dev proxy | Dev-only: forwards `/api/*` to Ollama, `/session` to the local Express server | `vite.config.js` |
| Express server | Prod: serves `dist/`, proxies `/api/*` to Ollama, persists `/session` | `server/index.js` |
| Ollama | Runs the actual models; two tags are used: a text model and a vision model | in-cluster `ollama` Service |
| ArgoCD + GHCR | Builds, publishes, and deploys the app on every push to `main` | `.github/workflows/docker-publish.yml`, `k8s/` |

## Request flow: sending a chat message

There is no application logic between the browser and Ollama for chat itself — the Express
server (or Vite in dev) is a pure reverse proxy that streams bytes through untouched.

```mermaid
sequenceDiagram
    participant U as Browser (React app)
    participant P as Proxy<br/>(Vite dev / Express prod)
    participant O as Ollama

    U->>U: pickModel(messages)<br/>text-only → TEXT_MODEL<br/>has images → VISION_MODEL
    U->>P: POST /api/chat<br/>{ model, messages, stream: true }
    P->>O: POST /api/chat<br/>(Origin header rewritten to Ollama's own origin)
    O-->>P: streamed NDJSON chunks
    P-->>U: streamed NDJSON chunks
    U->>U: append each chunk's content<br/>to the pending assistant message
```

Two details make this work:

- **Origin rewriting** — Ollama enforces an Origin allowlist (DNS-rebinding protection). Both
  proxies overwrite the `Origin` header to Ollama's own origin before forwarding, since the
  browser's real page origin would otherwise be rejected ([ADR-0005](./adr/0005-direct-vite-proxy-to-ollama.md)).
- **Model routing** — the model is decided client-side, per request, by `pickModel()`:
  whichever message array is about to be sent is scanned for a non-empty `images` field.

```mermaid
flowchart LR
    A[Messages to send] --> B{Any message has<br/>a non-empty images array?}
    B -- yes --> C[qwen2.5vl:3b<br/>VISION_MODEL]
    B -- no --> D[llama3.1:8b-instruct-q4_0<br/>TEXT_MODEL]
```

There is no model picker in the UI ([ADR-0009](./adr/0009-fixed-chat-mode-automatic-model-routing.md)) —
this decision is the only "model selection" that happens anywhere in the app.

## Image attachments

Images are read client-side into full data URLs (`data:image/...;base64,...`) so they can be
rendered directly in `<img>` tags and stored alongside conversation history. Ollama, however,
expects bare base64 with no prefix — that conversion happens in exactly one place,
`toOllamaMessage()`, right before a request is sent ([ADR-0008](./adr/0008-image-attachments-as-data-urls.md)).

```mermaid
flowchart LR
    F[File picked] -->|FileReader.readAsDataURL| D["data:image/png;base64,AAAA..."<br/>stored on message.images]
    D -->|rendered as-is| IMG["&lt;img src=...&gt;"]
    D -->|toOllamaMessage strips prefix| B["bare base64: AAAA..."<br/>sent as message.images to Ollama]
```

## Storage and sync

Conversations, profile name, and theme live in `localStorage` and work fully offline with no
backend running. Enabling "Sauvegarder sur le serveur" opts into syncing that same data to a
single JSON blob on the Express server, debounced by 1.2s ([ADR-0001](./adr/0001-local-first-storage-with-opt-in-sync.md),
[ADR-0002](./adr/0002-file-based-json-session-store.md)).

```mermaid
sequenceDiagram
    participant U as Browser
    participant S as Express /session
    participant FS as server/data/session.json

    Note over U: sync toggled on
    U->>S: GET /session
    S->>FS: read whole file
    FS-->>S: { conversations, profileName, theme }
    S-->>U: hydrate local state (if server has data)<br/>otherwise local state seeds the server

    Note over U: any later change (debounced 1.2s)
    U->>S: PUT /session { conversations, profileName, theme }
    S->>FS: overwrite whole file
```

There's a single implicit profile with no authentication ([ADR-0003](./adr/0003-no-authentication-single-implicit-profile.md)) —
this is a trusted-network, single-user tool, not a multi-tenant service.

## Deployment pipeline

```mermaid
flowchart TD
    A[git push to main] --> B{Touches only<br/>k8s/**, docs/**, **.md?}
    B -- yes --> Z[docker-publish workflow<br/>does not run]
    B -- no --> C[docker-publish.yml:<br/>build image]
    C --> D["push ghcr.io/koydas/ollama-chat:&lt;sha&gt;<br/>(+ :latest, unused by the Deployment)"]
    D --> E[workflow commits new tag<br/>into k8s/deployment.yaml]
    E --> F[push commit to main]
    F --> G[ArgoCD polls / gets refreshed]
    G --> H[Applies k8s/ manifests<br/>Deployment, Service, Ingress, PVC]
    H --> I[New pod pulls the new tag<br/>old pod terminates]
```

The workflow's own commit only touches `k8s/deployment.yaml`, which is in its own
`paths-ignore`, so it doesn't re-trigger itself ([ADR-0006](./adr/0006-gitops-deployment-via-ghcr.md)).
ArgoCD's `automated: { prune: true, selfHeal: true }` policy is what turns that commit into a
live rollout — no image-updater controller involved.

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
        subgraph "ollama namespace"
            OllamaSvc["ollama Service<br/>:11434"]
        end
        SvcLB["Service (LoadBalancer)<br/>192.168.1.244"]
        Ing["ingress-nginx<br/>192.168.1.243<br/>host: ollama-chat.home"]
    end
    Browser -->|http://192.168.1.244| SvcLB --> Pod
    Browser -->|http://ollama-chat.home| Ing --> Pod
    Pod -->|OLLAMA_URL| OllamaSvc
```

Reachable either via a dedicated MetalLB IP (`.244`, zero client-side setup) or through the
shared ingress at `ollama-chat.home` (`.243`, needs a `/etc/hosts` entry) — see
[ADR-0007](./adr/0007-dedicated-metallb-ip.md).
