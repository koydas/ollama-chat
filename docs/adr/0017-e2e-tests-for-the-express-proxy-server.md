# ADR-0017: End-to-end tests for the Express proxy server, gated in CI

- **Date:** 2026-07-30
- **Status:** Accepted

## Context

`server/index.js` (the Express backend: proxies `/api`, `/api/stt`, `/api/tts`
to Ollama/Whisper/Piper, and serves `/session` GET/PUT for opt-in sync) had
no test coverage of its own. `src/App.test.jsx` exercises the React app with
`fetch` stubbed (see `test-and-lint` skill) — that's real coverage of the
frontend, but it never runs the actual Express proxy, the Origin-header
rewrite it applies before forwarding to Ollama (see ADR-0005), or the
`/session` file-persistence logic. None of `server/index.js` was ever
actually executed by the test suite.

This gap matters concretely: `homelab-gateway` (the service this repo's
production traffic now routes through, ADR-0014) just had two real bugs
found only by manually sending varied traffic against the live cluster —
not by any test, because none existed there either until the same day. That
repo's `docs/adr/0001-mongodb-call-log.md` writes up the fix; the e2e suite
added there afterward is the direct model for this one.

## Decision

`server/index.e2e.test.js`: a real `app` instance (same `vitest` already in
use, not a new framework) driven with real HTTP requests against three fake
backends standing in for Ollama/Whisper/Piper, plus a throwaway
`SESSION_DATA_DIR`. No mocked `fetch`, no jsdom — this is the Node-side
counterpart to `src/App.test.jsx`'s browser-side coverage.

- `// @vitest-environment node` at the top of the file opts it out of the
  project-wide `jsdom` environment (`vite.config.js`'s `test.environment`).
  `src/setupTests.js` (global `setupFiles`, runs for every test file
  regardless of environment) previously called `Element.prototype...`
  unconditionally, which crashed under `node` — guarded with a
  `typeof Element !== 'undefined'` check, a one-line fix with no effect
  under `jsdom`.
- `server/index.js` needed two small changes to be importable without side
  effects: `DATA_DIR` now reads `SESSION_DATA_DIR` from the environment
  (defaulting to the original `server/data/` path) instead of a hardcoded
  path, so tests don't write into this repo's real session file; and both
  `app.listen()` calls (HTTP, and the conditional HTTPS one) are now guarded
  behind `import.meta.url === file://${process.argv[1]}`, so importing the
  module for tests doesn't also bind real ports — `export default app` is
  what the test file imports instead.
- Covers: `/api` proxy passthrough (path + body intact), the Origin-header
  rewrite regardless of what the client sent (a real historical bug class,
  see ADR-0005's Ollama-allowlist context), `/api/stt` → `/asr` and
  `/api/tts` → `/tts` path rewriting, `/session` GET with no file yet,
  PUT → GET round-trip verified on disk, and a corrupted session file
  producing a 500 instead of crashing the process.
- `.github/workflows/docker-publish.yml` gets a `test` job (lint + test +
  build) that `build-and-publish` now depends on (`needs: test`) — this
  repo had never gated a deploy on anything before; every push went
  straight to building and shipping an image regardless of whether
  `npm test`/`npm run lint`/`npm run build` would have failed.

## Alternatives Considered

- **A separate test runner/config for server-side tests (e.g. Node's
  built-in `node:test`, as `homelab-gateway` uses)** — rejected: this repo
  already has `vitest` wired up with per-file environment overrides
  supported out of the box; introducing a second test runner for one file
  would cost more (two configs, two ways to run tests) than the
  `@vitest-environment node` docblock + one guard in `setupTests.js`.
- **Leave `setupTests.js`'s jsdom-only line unconditional, scope it out via
  `environmentMatchGlobs` in `vite.config.js` instead** — rejected as more
  moving parts for the same outcome: `environmentMatchGlobs` changes which
  environment a file gets, but `setupFiles` still runs for every file
  regardless, so the crash would persist either way. The one-line guard
  fixes it directly without adding new config surface.
- **Mock `http-proxy-middleware` instead of using real fake HTTP servers**
  — rejected: the whole point is verifying real proxy behavior (path
  rewriting, header mutation) the way `homelab-gateway`'s suite does;
  mocking the proxy library would only prove the mocks were called
  correctly, not that requests actually go where they're supposed to.

## Consequences

**Good:**
- The Origin-rewrite bug class (ADR-0005) and the `/session` corrupted-file
  path now have regression coverage; previously neither was exercised by
  any test.
- CI now fails a bad push before it ever gets built or deployed, instead of
  after — first gate this repo has had.

**Neutral:**
- `server/index.js` gained two small testability-only changes
  (`SESSION_DATA_DIR`, the `import.meta.url` listen-guard) that don't alter
  default runtime behavior — both env vars are unset in production, so the
  original hardcoded paths/behavior still apply there.

**Negative:**
- ⚠️ Static-file serving (`dist/` fallback to `index.html`) is untested —
  CI's `test` job runs before `npm run build`, so `dist/` doesn't exist at
  that point and the branch is simply skipped, same as local dev without a
  build. Not covered by this suite either way.
