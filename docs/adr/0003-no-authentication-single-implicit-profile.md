# ADR-0003: No authentication — single implicit local profile

- **Date:** 2026-07-27
- **Status:** Accepted

## Context

The profile menu (name, theme, sync toggle) implies "user identity," but the app has
no login system and is meant to be used by one person per browser/device.

## Decision

There is exactly one implicit profile per client, identified by nothing more than
`localStorage` (and, if sync is on, the single blob on the sync server, per ADR-0001/
ADR-0002). The profile name is a free-text display label with no authentication
semantics — it does not gate access to anything.

## Alternatives Considered

- **Full accounts (login, sessions, multi-user)** — rejected: no multi-user
  requirement; would require an auth system, credential/session storage, and hardening
  `/session` against unauthorized access — all disproportionate to current scope.

## Consequences

- ✅ Minimal surface area — no credentials to manage or leak.
- ✅ Matches actual usage (one person, one Ollama instance).
- ⚠️ If the sync backend is ever exposed beyond localhost, anyone reaching it can
  read/overwrite the single session blob — the design assumes a trusted network.
- ⚠️ Revisit if multi-user support is ever required — this ADR will need to be
  superseded.
