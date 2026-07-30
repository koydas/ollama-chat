---
description: Test/lint/build commands and this repo's convention of putting testable logic in src/lib/conversations.js rather than inline in App.jsx.
---

# test-and-lint

## When to Apply

Any time you modify `src/`, `server/`, or add a dependency — before considering the change
done.

## Expected Behavior

### Commands

```
npm test          # vitest run — the only test runner, no Jest/Mocha
npm run lint       # oxlint
npm run build      # vite build — must succeed; this is what the Docker image actually ships
```

Run all three before calling a change complete. A change that passes `npm test` but fails
`npm run build` (or vice versa) is not done.

### Three test layers, matching three files

- **`src/lib/conversations.test.js`** — direct unit tests of pure functions
  (`pickModel`, `toOllamaMessage`, `deriveTitle`, `formatRelativeTime`, the `load*` helpers,
  etc.). If you're adding logic that doesn't need a DOM, it belongs in
  `src/lib/conversations.js`, not inline in `App.jsx` — that's what makes it cheaply
  unit-testable instead of only reachable through a full component render.
- **`src/App.test.jsx`** — integration tests of the rendered app, using
  `@testing-library/react` + `@testing-library/user-event`, with `fetch` stubbed via
  `vi.stubGlobal('fetch', mockFetch({ chatChunks: [...] }))`. Use the existing `mockFetch`/
  `streamResponse` helpers at the top of the file rather than hand-rolling new response
  mocks — they already model Ollama's real NDJSON streaming shape.
- **`server/index.e2e.test.js`** — the real Express app (`server/index.js`) driven with real
  HTTP requests against three fake HTTP backends standing in for Ollama/Whisper/Piper, using
  vitest's `// @vitest-environment node` per-file override (no jsdom, no mocked `fetch` — the
  Node-side counterpart to `App.test.jsx`'s browser-side coverage). Covers proxy routing, the
  Origin-header rewrite, and `/session` persistence. If you're adding logic to `server/index.js`
  itself (a new proxy route, a new persisted field), it belongs here, not as a manual curl
  check — see `docs/adr/0017-e2e-tests-for-the-express-proxy-server.md`.

### Never shrink an existing test file

Before editing `App.test.jsx`, `conversations.test.js`, or `server/index.e2e.test.js`, note
the current number of `it(`/`test(` blocks. Your diff should have at least that many, unless a
test is being removed because the behavior it tested was deliberately removed in the same
change (e.g. the model-dropdown test was deleted only because the dropdown itself was deleted
— not as a shortcut).

### When removing a feature's UI, check for readiness-signal assumptions in tests

Several `App.test.jsx` tests use `await screen.findByText('Chat')` purely to wait for the
initial `/api/tags` effect to settle before interacting further — it is not really a check
"the Chat label is correct," it's a synchronization point. If you ever change what renders
after that effect, check whether other tests are relying on it as their wait condition before
assuming they're independent.

## Constraints

- No new test framework or assertion library — `vitest` + `@testing-library/*`, already in
  `package.json`, is the full stack.
- Don't add dependencies without checking `package.json` first; this is a small app and new
  deps should be justified (see how few there are today).
- `oxlint` producing no output means no errors — don't add a step to "confirm" that beyond
  checking the exit code.

## References

- `src/lib/conversations.js` / `src/lib/conversations.test.js` — pure-logic-first pattern
- `src/App.test.jsx` — `mockFetch`/`streamResponse` helpers, the pattern to reuse for new tests
- `server/index.e2e.test.js` — `createFakeBackend`/`readBody` helpers, the pattern to reuse for new server-side e2e tests
- `package.json` — `scripts` for the exact commands and current dependency list
