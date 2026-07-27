# ADR-0001: Local-first storage with opt-in server sync

- **Date:** 2026-07-27
- **Status:** Accepted

## Context

`ollama-chat` is a personal, single-user tool with no accounts. Conversations, the
selected model, and profile settings need to survive reloads. Some usage patterns
(switching devices/browsers) benefit from server-side persistence, but requiring an
always-on backend just to use the app would be disproportionate for a local Ollama
chat client.

## Decision

`localStorage` is the source of truth at all times for conversations, profile name,
theme, and selected model. A small Express backend (`server/index.js`) exposes
`GET/PUT /session` for a single opt-in JSON blob. The frontend only talks to it once
the user enables "Sauvegarder sur le serveur" in the profile menu:
- on enabling, it hydrates once from the server, adopting server data if present,
  otherwise seeding the server from local state
- afterward, every change to conversations/profile/theme is pushed to the server,
  debounced by 1.2s

## Alternatives Considered

- **Always-on server-side storage as the only source of truth** — rejected: forces a
  running backend for the app to be usable at all, adding an unnecessary failure mode
  to a local single-user tool.
- **Real accounts/auth backing the sync** — rejected: no multi-user requirement exists;
  disproportionate to current scope (see ADR-0003).

## Consequences

- ✅ App works fully offline / with no backend process running.
- ✅ Sync is additive and low-risk — turning it off returns to pure `localStorage` behavior.
- ⚠️ No conflict resolution: last write wins between hydrate and push; concurrent
  tabs/devices with sync on can clobber each other.
- ⚠️ No auth on `/session` — any client reaching the backend can read/overwrite the
  single stored blob.
