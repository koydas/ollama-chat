# ADR-0002: File-based JSON store for the session sync backend

- **Date:** 2026-07-27
- **Status:** Accepted

## Context

The opt-in server sync feature (ADR-0001) needs somewhere to persist the synced
payload (conversations + profile name + theme) server-side. The tool is single-user
and runs on a homelab machine with no existing database infrastructure dedicated to it.

## Decision

Persist the entire synced payload as one JSON file (`server/data/session.json`),
read and written whole on each `GET`/`PUT /session` call. `server/data/` is gitignored.

## Alternatives Considered

- **SQLite / relational DB** — rejected: no querying, relations, or concurrent-writer
  needs exist; a single JSON blob already matches the exact shape of the data being
  synced.
- **Object storage / cloud DB** — rejected: single-user local tool, no need for
  persistence beyond the same host.

## Consequences

- ✅ Zero infrastructure — no DB engine, migrations, or schema needed.
- ✅ Trivial to inspect or back up (`cat server/data/session.json`).
- ⚠️ Whole-file read/write on every sync — fine at this data size, would not scale to
  multiple users or large history.
- ⚠️ No file locking — concurrent `PUT`s (e.g. two tabs syncing at once) can race;
  acceptable for a single-user tool.
