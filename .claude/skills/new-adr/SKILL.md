---
description: Procedure for adding a new ADR to this repo — numbered file in docs/adr/, index update in docs/adr/README.md. No changelog gate here (that's autonomous-dev-loop-specific).
---

# new-adr

## When to Apply

When making a design or technical decision worth remembering the reasoning for: storage
choices, auth/security posture, the chat proxy path, model routing, theming, deployment
topology, or anything where a future reader (human or agent) would otherwise have to
re-derive "why is it built this way?" from scratch.

## Expected Behavior

### Step 1 — Determine the next ADR number

```
ls docs/adr/[0-9][0-9][0-9][0-9]-*.md | sort
```

Take the highest number and increment by one. Four digits, zero-padded (e.g. `0010`). The
numeric glob excludes `README.md` from the sort.

### Step 2 — Create the ADR file

`docs/adr/<NNNN>-<kebab-case-title>.md`:

```markdown
# ADR-<NNNN>: <Title>

- **Date:** <YYYY-MM-DD>
- **Status:** Accepted

## Context

[What problem or situation prompted this decision?]

## Decision

[What was decided, and how does it work? Be specific — name the actual files/functions
involved, not just the concept.]

## Alternatives Considered

[What else was considered, and why was it rejected? "Rejected: <reason>" per alternative.]

## Consequences

[Trade-offs. ✅ for benefits, ⚠️ for drawbacks/caveats — including ones that only bite
later, like hardcoded values or missing runtime checks.]
```

Read 2-3 existing ADRs in `docs/adr/` first to match tone and level of detail — they're
meant to read as a connected series, not standalone essays.

### Step 3 — Add to the index

Append a line to `docs/adr/README.md`'s `## Records` list:

```markdown
- [ADR-<NNNN>: <Title>](./<NNNN>-<kebab-case-title>.md)
```

### Step 4 — Cross-link from the source

If the decision changes something a reader would hit while reading code (a constant, a
function, a config file), add a one-line comment or doc pointer to the relevant ADR at that
spot — see `pickModel()` in `src/lib/conversations.js` or the routing note in
`docs/chat-and-images.md` for the pattern.

## Constraints

- Do not skip the `docs/adr/README.md` index update — an un-indexed ADR is effectively
  invisible.
- ADR numbers must be sequential with no gaps.
- Status must be `Accepted` (or `Proposed` if genuinely still under discussion) — no custom
  statuses.
- **No changelog gate in this repo.** Unlike `autonomous-dev-loop`'s `new-adr` skill (which
  this one is modeled after), `ollama-chat` has no `CHANGELOG.md` and no CI gate requiring
  one — do not add that step here.
- Don't write an ADR for something reversible and inconsequential (e.g. a CSS color tweak).
  If in doubt, ask: "would someone be confused in 6 months without this written down?"

## References

- `docs/adr/README.md` — the index to update
- `docs/adr/0007-dedicated-metallb-ip.md`, `docs/adr/0009-fixed-chat-mode-automatic-model-routing.md` — good length/tone reference
- `docs/architecture.md` and its linked pages (`chat-and-images.md`, `vocal-mode.md`, `storage-sync.md`, `deployment.md`) — diagrams that may need a matching update alongside a new ADR
