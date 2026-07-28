# ollama-chat

A React/Vite chat UI backed by a local Ollama instance, with an Express backend for opt-in server-side session sync.

## Development

```
npm install
npm run dev      # frontend only (proxies /api to Ollama)
npm run dev:all  # frontend + session sync backend
npm test
```

## Deployment

Runs on the homelab microk8s cluster via ArgoCD, managed from
[`koydas/gitops-homelab`](https://github.com/koydas/gitops-homelab)
(`apps/ollama-chat/application.yaml`). Manifests live here under `k8s/`.

On every push to `main`, `.github/workflows/docker-publish.yml` builds the image, pushes it
to `ghcr.io/koydas/ollama-chat:<sha>`, and commits the new tag into `k8s/deployment.yaml` —
that commit is what ArgoCD syncs on. See [docs/adr/0006](./docs/adr/0006-gitops-deployment-via-ghcr.md).
