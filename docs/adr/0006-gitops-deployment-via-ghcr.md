# ADR-0006: GitOps deployment via GHCR image + CI-committed tag bump

- **Date:** 2026-07-28
- **Status:** Accepted

## Context

`ollama-chat` needs to run on the same microk8s/ArgoCD homelab cluster as Ollama itself
(see `koydas/gitops-homelab`), instead of only being run locally with `npm run dev:all`.
`server/index.js` already defaults `OLLAMA_URL` to the in-cluster Ollama Service DNS name
(`http://ollama.ollama.svc.cluster.local:11434`) in anticipation of this — see the comment
there and ADR-0005's note that production builds had no reverse proxy set up yet.

Every existing app in `gitops-homelab` (Ollama, kube-prometheus-stack, ingress-nginx) is a
public Helm chart referenced directly by an ArgoCD `Application`. `ollama-chat` has no such
chart — it's a custom Node/Vite app with a `Dockerfile`, so onboarding it means deciding
where the image lives, where the Kubernetes manifests live, and how ArgoCD learns about a
new build.

## Decision

- **Manifests live in this repo**, under `k8s/` (plain Kustomize: Deployment, Service,
  Ingress, PVC), not in `gitops-homelab`. `gitops-homelab`'s `apps/ollama-chat/application.yaml`
  just points its `source` at this repo + `path: k8s`, the same shape as the Helm-chart
  Applications but with a git source instead of a chart source.
- **Image published to `ghcr.io/koydas/ollama-chat`** by `.github/workflows/docker-publish.yml`
  on every push to `main`, tagged with the short commit SHA (and `:latest` alongside, for
  convenience/manual pulls only — the Deployment never uses `:latest`).
- **The workflow commits the new SHA tag into `k8s/deployment.yaml` and pushes it back to
  `main`.** This is what makes a new build an actual Git change ArgoCD can sync on, using the
  existing `automated: { prune: true, selfHeal: true }` policy — no separate image-updater
  controller needed. The workflow triggers on `push: branches: [main]` with
  `paths-ignore: [k8s/**, docs/**, **.md]`, so its own commit (which only touches
  `k8s/deployment.yaml`) doesn't re-trigger itself.
- **Session persistence:** `server/data/session.json` (ADR-0002) is backed by a 1Gi
  `microk8s-hostpath` PVC (`ollama-chat-session`), same storage class Ollama's own PVC uses
  in `gitops-homelab`, so the local-first sync blob (ADR-0001) survives pod restarts/redeploys
  instead of resetting.
- **Ingress, not a dedicated MetalLB IP:** routed through the existing `ingress-nginx`
  controller (`gitops-homelab` ADR-0014) at hostname `ollama-chat.home`, since that ADR
  specifically anticipated onboarding future HTTP apps this way rather than spending another
  MetalLB address.

## Alternatives Considered

- **Argo CD Image Updater** — would watch the GHCR repo and bump the tag itself, removing the
  "CI commits back to main" step. Rejected for now: another controller to run and configure
  for a homelab with one custom app; the CI-commits-the-tag approach is a few lines in a
  workflow already doing the build, and keeps the deployed tag's history visible as ordinary
  commits.
- **`:latest` + `imagePullPolicy: Always`** — rejected: gives ArgoCD nothing to diff/sync on a
  new push (the manifest doesn't change), so a new image would silently not roll out without a
  manual `kubectl rollout restart`.
- **Manifests in `gitops-homelab` instead of here** — rejected per this repo owning its own
  deployment shape (matches how the app and its Dockerfile already live together); would also
  mean two repos to touch for any change to resource limits, env, or the Ingress host.
- **Dedicated MetalLB IP** — rejected: `gitops-homelab` ADR-0014 already exists specifically to
  avoid spending a new MetalLB address per HTTP app.

## Consequences

- ✅ New commits to `main` deploy automatically end-to-end (build → push → tag bump → ArgoCD
  sync) with no extra homelab-side component.
- ✅ Deployed image tag is always an immutable SHA, visible in `git log` on this repo.
- ⚠️ The GHCR package's visibility must be set to public once, manually, via the package's
  GitHub settings (a fresh package defaults to private regardless of this repo being public) —
  otherwise the cluster needs an `imagePullSecret` this setup deliberately avoids.
- ⚠️ `ollama-chat.home` needs a local `/etc/hosts` entry (or LAN DNS) pointing at `192.168.1.243`
  — no DNS server exists in this environment yet (same caveat as ADR-0014).
- ⚠️ Single replica + `ReadWriteOnce` PVC means a redeploy briefly drops the running pod;
  acceptable for a single-user homelab chat UI, not acceptable if this ever needs HA.
