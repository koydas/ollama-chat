# ollama-chat

A React/Vite chat UI backed by a local Ollama instance, with an Express backend for opt-in server-side session sync.

## Development

```
npm install
npm run dev      # frontend only (proxies /api to Ollama)
npm run dev:all  # frontend + session sync backend
npm test
```
