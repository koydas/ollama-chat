# ADR-0004: Manual theme override via CSS custom properties and `data-theme`

- **Date:** 2026-07-27
- **Status:** Accepted

## Context

The app already followed the OS-level `prefers-color-scheme` automatically via CSS
custom properties in `index.css`. The profile menu adds a manual Système/Clair/Sombre
choice, which must be able to override the system preference when the user picks
Clair or Sombre explicitly.

## Decision

Keep the existing `@media (prefers-color-scheme: dark)` block for the default
"Système" behavior, and add `:root[data-theme="dark"]` / `:root[data-theme="light"]`
blocks after it in source order so they win regardless of the OS preference.
`App.jsx` sets or removes the `data-theme` attribute on `<html>` based on the stored
`theme` value.

## Alternatives Considered

- **A theming library / context provider** — rejected: the app already used plain CSS
  custom properties; a library would add a dependency to solve a three-state toggle.
- **JS-computed inline styles** — rejected: would bypass the existing CSS variable
  system and duplicate color values in JS.

## Consequences

- ✅ No new dependency; reuses the existing CSS variable architecture.
- ✅ "Système" keeps following OS changes live (media query), while Clair/Sombre stay
  pinned regardless of OS.
- ⚠️ Relies on source-order specificity — the override blocks must stay after the
  media query block in `index.css`, which can break silently if reordered.
