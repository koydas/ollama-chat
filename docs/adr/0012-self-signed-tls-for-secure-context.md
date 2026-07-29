# ADR-0012: Self-signed TLS on both access paths, so vocal mode gets a secure context

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

A first pass added TLS only to the `ollama-chat.home` Ingress route. That fixed vocal mode on
desktop (which already had an `/etc/hosts` entry for that hostname), but phones have no
practical way to add a custom hosts entry without root/jailbreak — `https://ollama-chat.home`
failed with a DNS resolution error on mobile, with no local DNS server in this environment to
resolve it (per `gitops-homelab`'s architecture notes) and no router-level override applied.

## Decision

Both access paths now get TLS, using the same self-signed certificate (`ollama-chat-tls`
Secret, 10-year validity, SANs for both `DNS:ollama-chat.home` and `IP:192.168.1.244`):

```
openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -subj "/CN=ollama-chat.home" \
  -addext "subjectAltName=DNS:ollama-chat.home,IP:192.168.1.244"
```

- **`ollama-chat.home`**: TLS terminated by `ingress-nginx` via the `tls` block in
  `k8s/ingress.yaml`, as before.
- **The bare `192.168.1.244` IP** (ADR-0007's dedicated MetalLB IP, chosen specifically for
  "no client-side setup" — no hostname resolution needed at all): TLS is now terminated
  **inside the app itself**, since this path bypasses `ingress-nginx` entirely. `server/index.js`
  starts a second listener via Node's `https` module (port 8443) alongside the existing plain
  HTTP one (port 8080), only when a cert is actually mounted (`fs.existsSync` guard — local
  dev/tests are unaffected). `k8s/deployment.yaml` mounts the same `ollama-chat-tls` Secret as
  a volume at `/app/certs` (the standard `tls.crt`/`tls.key` keys a `kubernetes.io/tls` Secret
  exposes); `k8s/service.yaml` adds a `443 → 8443` port alongside the existing `80 → 8080`.

The Secret is created **once, out-of-band**, the same way `gitops-homelab`'s ADR-0012
handles Grafana's admin credentials: never committed to Git, created directly with
`kubectl create secret tls ollama-chat-tls --cert=... --key=... -n ollama-chat`. Regenerate
and recreate it (same command, new files with both SANs) if it's ever lost — there's no
automation for this, matching this repo's overall level of infrastructure.

Browsers show a "connection is not private" warning on first visit to either path
(self-signed, not CA-trusted) — click through once per device/browser. Once accepted, the
page is served over HTTPS and the origin counts as a secure context for `getUserMedia`,
regardless of the certificate not being CA-trusted (per the Secure Contexts spec, scheme +
successful TLS handshake is what matters, not certificate trust).

## Alternatives Considered

- **Fix DNS at the router/Pi-hole level instead** (map `ollama-chat.home` to `.243` for every
  device automatically) — considered and still the cleaner fix if/when router access is
  convenient, but not chosen here: it depends on hardware/access not guaranteed to be
  available, while terminating TLS in the app itself needs no external dependency and works
  immediately on any device that can reach the IP.
- **cert-manager with a self-signed `ClusterIssuer`** — rejected: adds a whole new controller
  plus its own CRDs to an already CRD-heavy single-node cluster (this exact class of problem
  — oversized CRD annotations breaking ArgoCD's `last-applied-configuration` — already bit
  `kube-prometheus-stack`'s install, per `gitops-homelab`'s runbook). A cert that needs no
  automatic rotation doesn't justify that ongoing complexity.
- **A publicly-trusted certificate** (e.g. Let's Encrypt) — rejected outright: requires either
  a public DNS name and public HTTP-01/DNS-01 challenge capability or a CA the browser already
  trusts, both of which contradict the explicit LAN-only, no-public-ingress posture from
  `gitops-homelab`'s ADR-0002.
- **Per-device `chrome://flags/#unsafely-treat-insecure-origin-as-secure`** — rejected as the
  primary fix: works, but must be reconfigured on every browser/device, is Chromium-specific,
  and doesn't help phones reach `ollama-chat.home` (the DNS problem, not just the secure
  context) at all.

## Consequences

- ✅ Vocal mode now works on every device/browser that can reach either
  `https://ollama-chat.home` or `https://192.168.1.244`, without router/DNS changes.
- ✅ No new controller, CRD, or ongoing renewal process — consistent with this cluster's
  existing preference for the simplest infrastructure that satisfies the actual requirement.
- ⚠️ TLS termination now lives in two places (`ingress-nginx` for the hostname,
  `server/index.js` itself for the bare IP) instead of one — a future cert rotation must
  update both the Ingress and the Deployment's mounted Secret (in practice the same Secret,
  so one `kubectl` command covers both, but it's worth remembering both consume it).
- ⚠️ The private key lives only in the live cluster Secret, never in Git — if it's lost, it
  must be regenerated (with both SANs) and every browser will show the trust warning again.
