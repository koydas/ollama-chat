# ADR-0012: Self-signed TLS on the Ingress, so vocal mode gets a secure context

- **Date:** 2026-07-28
- **Status:** Accepted

## Context

After deploying server-side Whisper/Piper (ADR-0011), the mic button consistently failed
with "Le microphone n'est pas accessible" on every device except the server itself. The
cause: `navigator.mediaDevices` (and therefore `getUserMedia`/`MediaRecorder`) is only
exposed by browsers on a *secure context* — HTTPS, or `http://localhost`. `ollama-chat` is
served over plain HTTP on the LAN (`http://192.168.1.244` or `http://ollama-chat.home`),
deliberately, per ADR-0002 in `gitops-homelab` (LAN-only exposure, no public ingress, no
TLS). That decision is still right for the exposure boundary; it just didn't anticipate a
feature that needs a secure context to function at all.

## Decision

`k8s/ingress.yaml` gets a `tls` block for `ollama-chat.home`, backed by a Secret
(`ollama-chat-tls`) containing a self-signed certificate, valid 10 years
(`openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -subj "/CN=ollama-chat.home" -addext
"subjectAltName=DNS:ollama-chat.home"`), created **once, out-of-band**, the same way
`gitops-homelab`'s ADR-0012 handles Grafana's admin credentials: never committed to Git,
created directly with `kubectl create secret tls ollama-chat-tls --cert=... --key=... -n
ollama-chat`. Regenerate and recreate the Secret (same command, new files) if it's ever lost
— there's no automation for this, matching this repo's overall level of infrastructure.

Vocal mode now requires accessing the app via `https://ollama-chat.home` (already the
existing `/etc/hosts` route documented in the README) rather than the bare
`http://192.168.1.244` IP — the direct LoadBalancer IP path bypasses `ingress-nginx`
entirely, so it has no TLS termination and stays plain HTTP. Text chat and every other
feature keep working over either path exactly as before; only vocal mode's mic input needs
the HTTPS route.

Browsers will show a "connection is not private" warning on first visit (self-signed, not
CA-trusted) — click through once per device/browser. Once accepted, the page is served over
HTTPS and the origin counts as a secure context for `getUserMedia`, regardless of the
certificate not being CA-trusted (per the Secure Contexts spec, scheme + successful TLS
handshake is what matters, not certificate trust).

## Alternatives Considered

- **cert-manager with a self-signed `ClusterIssuer`** — rejected: adds a whole new
  controller plus its own CRDs to an already CRD-heavy single-node cluster (this exact class
  of problem — oversized CRD annotations breaking ArgoCD's `last-applied-configuration` —
  already bit `kube-prometheus-stack`'s install, per `gitops-homelab`'s runbook). A cert that
  needs no automatic rotation (10-year validity, single internal hostname, one person)
  doesn't justify that ongoing complexity.
- **A publicly-trusted certificate** (e.g. Let's Encrypt) — rejected outright: requires
  either a public DNS name and public HTTP-01/DNS-01 challenge capability or a CA the browser
  already trusts, both of which contradict the explicit LAN-only, no-public-ingress posture
  from `gitops-homelab`'s ADR-0002.
- **Per-device `chrome://flags/#unsafely-treat-insecure-origin-as-secure`** — rejected as the
  primary fix: works, but must be reconfigured on every browser/device that uses vocal mode,
  and is Chromium-specific (no equivalent in Firefox/Safari). Kept in mind as a fallback if
  the TLS route is ever inconvenient on a specific device.

## Consequences

- ✅ Vocal mode now works on every device/browser that accepts the one-time certificate
  warning, without per-device configuration.
- ✅ No new controller, CRD, or ongoing renewal process — consistent with this cluster's
  existing preference for the simplest infrastructure that satisfies the actual requirement
  (see also `gitops-homelab`'s ADR-0016, CPU-only Whisper/Piper for the same reasoning style).
- ⚠️ The bare IP path (`http://192.168.1.244`, ADR-0007's "works with no client-side setup"
  reason for a dedicated LoadBalancer IP) does not get TLS and therefore cannot run vocal
  mode — only the `https://ollama-chat.home` hostname route can, which already requires an
  `/etc/hosts` entry.
- ⚠️ The private key lives only in the live cluster Secret, never in Git — if it's lost
  (e.g. namespace deleted, PVC-less by design here), it must be regenerated and every
  browser will show the trust warning again for the new cert.
