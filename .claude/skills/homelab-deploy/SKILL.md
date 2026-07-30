---
description: How pushing to main actually reaches the running app — the CI auto-commit-back gotcha, forcing an ArgoCD refresh, and verifying/installing the Ollama models this app depends on.
---

# homelab-deploy

## When to Apply

Any time you push a commit to `main` in this repo and expect the live app at
`http://192.168.1.244` / `http://ollama-chat.home` to reflect it, or when you touch the
hardcoded model tags in `src/lib/conversations.js` (`TEXT_MODEL` / `VISION_MODEL`).

## Expected Behavior

### Pushing to main: expect a rejected push, it's not an error

`.github/workflows/docker-publish.yml` builds the image on every non-docs push to `main`
and **commits the new tag back into `k8s/deployment.yaml` on `main`**
(see `docs/adr/0006-gitops-deployment-via-ghcr.md`). If that workflow's commit lands between
your last `git fetch` and your `git push`, the push is rejected with:

```
! [rejected]  main -> main (fetch first)
```

This is expected, not a conflict with someone else's work. Resolve it every time the same
way:

```
git fetch origin
git log --oneline main..origin/main   # sanity check: should only be a "chore: deploy <sha>" commit
git pull --rebase origin main
git push origin main
```

Docs-only changes (`docs/**`, `**.md`, or anything under `k8s/**`) are in the workflow's
`paths-ignore` and won't trigger a rebuild — no rejected-push dance expected for those.

### Confirming the build actually ran

```
gh run list --limit 1
```

Wait for `status: completed` / `conclusion: success` before assuming the image exists in
GHCR. Don't guess at CI outcomes — check.

### Getting ArgoCD to pick it up now, not in ~3 minutes

ArgoCD polls Git periodically; to see a just-pushed change reflected immediately:

```
sudo microk8s kubectl -n argocd annotate application ollama-chat argocd.argoproj.io/refresh=hard --overwrite
sudo microk8s kubectl -n argocd get application ollama-chat -o custom-columns=SYNC:.status.sync.status,HEALTH:.status.health.status,REV:.status.sync.revision
```

Confirm the `REV` column matches the latest commit SHA on `origin/main` before declaring the
deploy done.

### Confirming the pod actually rolled out

```
sudo microk8s kubectl get pods -n ollama-chat -o wide
```

Expect exactly one `Running` pod on the new ReplicaSet and the old one `Terminating`/gone. A
transient `ImagePullBackOff` right after rollout (e.g. a GHCR TLS handshake timeout) is
usually just network contention — kubelet retries with backoff; give it a minute before
treating it as broken.

### Verifying/installing the models this app hardcodes

`pickModel()` in `src/lib/conversations.js` hardcodes two Ollama tags with no runtime
existence check (`docs/adr/0009-fixed-chat-mode-automatic-model-routing.md` flags this).
Before changing either constant, or after a fresh server, confirm what's actually installed:

```
sudo microk8s kubectl exec -n ollama deploy/ollama -- ollama list
```

To install a missing tag:

```
sudo microk8s kubectl exec -n ollama deploy/ollama -- ollama pull <tag>
```

This can take tens of minutes for multi-GB vision models on home bandwidth — run it with
`run_in_background: true` rather than blocking on it, and note the `ollama` namespace is
distinct from the `ollama-chat` namespace (the app) and the `gitops-homelab` repo (the
ArgoCD source of truth for the `ollama` Ollama deployment itself, not this app).

## Constraints

- `kubectl` is not installed bare on this host — always `sudo microk8s kubectl`.
- Don't force-push or reset to work around the rejected-push case above — always rebase onto
  the CI commit; it's always safe to fast-forward through.
- Don't assume a push deployed just because `git push` succeeded — check the CI run, then
  ArgoCD's `REV`, then the pod, in that order.

## References

- `docs/adr/0006-gitops-deployment-via-ghcr.md` — why CI commits back to `main`
- `docs/adr/0009-fixed-chat-mode-automatic-model-routing.md` — the hardcoded-model-tags caveat
- `docs/deployment.md` — deployment pipeline diagram; `docs/architecture.md` — runtime topology diagram
- `.github/workflows/docker-publish.yml` — exact trigger/paths-ignore rules
