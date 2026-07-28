# ADR Index

Architecture Decision Records (ADR) for `ollama-chat`.

## Records

- [ADR-0001: Local-first storage with opt-in server sync](./0001-local-first-storage-with-opt-in-sync.md)
- [ADR-0002: File-based JSON store for the session sync backend](./0002-file-based-json-session-store.md)
- [ADR-0003: No authentication — single implicit local profile](./0003-no-authentication-single-implicit-profile.md)
- [ADR-0004: Manual theme override via CSS custom properties and `data-theme`](./0004-manual-theme-override.md)
- [ADR-0005: Direct Vite proxy to Ollama for chat (no chat backend)](./0005-direct-vite-proxy-to-ollama.md)
- [ADR-0006: GitOps deployment via GHCR image + CI-committed tag bump](./0006-gitops-deployment-via-ghcr.md)
- [ADR-0007: Dedicated MetalLB IP alongside the Ingress](./0007-dedicated-metallb-ip.md)
- [ADR-0008: Image attachments stored as data URLs, converted to bare base64 at the Ollama boundary](./0008-image-attachments-as-data-urls.md)
- [ADR-0009: Fixed "Chat" mode with automatic model routing, no model picker](./0009-fixed-chat-mode-automatic-model-routing.md)
- [ADR-0010: Voice mode via the browser's native Web Speech API, no server involvement](./0010-browser-web-speech-api-for-voice-mode.md)
- [ADR-0011: Server-side Whisper/Piper replace the Web Speech API for voice mode](./0011-server-side-stt-tts-whisper-piper.md)
