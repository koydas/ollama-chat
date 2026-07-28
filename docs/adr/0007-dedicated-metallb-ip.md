# ADR-0007: Dedicated MetalLB IP alongside the Ingress

- **Date:** 2026-07-28
- **Status:** Accepted

## Context

ADR-0006 routed `ollama-chat` through `gitops-homelab`'s `ingress-nginx` at hostname
`ollama-chat.home`, specifically to avoid spending a MetalLB address per app (see
`gitops-homelab` ADR-0014/0015). That works, but ingress-nginx routes by `Host` header —
hitting the bare IP (`192.168.1.243`) without a matching hostname returns ingress-nginx's
own 404, and getting a hostname to resolve requires a per-device `/etc/hosts` entry (or LAN
DNS, which doesn't exist here yet). For simply trying the app out from a new device, that
setup step is friction the operator wants to skip.

## Decision

`k8s/service.yaml`'s `Service` is `type: LoadBalancer` with
`metallb.io/loadBalancerIPs: "192.168.1.244"` (pinned, same technique as
`gitops-homelab apps/ingress-nginx`) — the next free address after `.243`. This is
**in addition to**, not instead of, the Ingress: the Service backs both, so
`http://192.168.1.244` works directly with zero client-side config, and
`http://ollama-chat.home` (via `.243`) still works once a hostname is set up.

## Alternatives Considered

- **Ingress-only (status quo)** — rejected: doesn't satisfy "test from a fresh device with
  no setup," which was the actual ask.
- **Host-less catch-all Ingress rule on `.243`** — would route bare-IP requests to
  `ollama-chat` without a new MetalLB address, but only works while `ollama-chat` is the
  *only* app behind the ingress; breaks (needs an arbitrary tiebreak) the moment a second
  host-routed app is onboarded. Rejected as a foundation to build more apps on, even though
  it's cheaper today.

## Consequences

- ✅ `http://192.168.1.244` works immediately, no `/etc/hosts` edit, matching how
  ArgoCD/Ollama/Grafana are already used in this homelab.
- ⚠️ Reintroduces the per-app MetalLB address this whole approach (`gitops-homelab`
  ADR-0014) was meant to move away from — pool has 6 addresses left after this
  (`.245`-`.250`). Acceptable for one app; revisit the ingress-only model if it recurs.
- Neutral: the Ingress stays in place and still works once a hostname is configured —
  this doesn't replace ADR-0006's routing, it adds a second path to the same Service.
