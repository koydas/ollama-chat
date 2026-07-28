# ADR-0010: Voice mode via the browser's native Web Speech API, no server involvement

- **Date:** 2026-07-28
- **Status:** Accepted

> **Note (2026-07-28):** revisited in
> [ADR-0011](./0011-server-side-stt-tts-whisper-piper.md) — the Firefox gap and the need for
> self-hosted, non-browser-vendor speech processing motivated moving to server-side
> Whisper/Piper. Kept here for the reasoning that held until then.

## Context

The operator asked for a "vocal" option so a conversation can be driven by voice: dictate the
user message instead of typing, and hear the assistant's reply instead of reading it. The app
already has no chat backend in the request path (ADR-0005) and is single-user, local-first
(ADR-0001) — adding speech-to-text/text-to-speech should not change either of those
properties by routing audio through a new server component.

## Decision

Voice mode is a per-profile toggle (`voiceMode`, `VOICE_MODE_KEY` in
`src/lib/conversations.js`, mirroring the existing `theme` toggle from ADR-0004) with two
values, `'text'` (default) and `'vocal'`, picked from a "Mode" `<select>` next to "Thème" in
the profile menu.

Both directions use the browser's built-in Web Speech API directly in `App.jsx`, with no
new dependency and no audio ever leaving the browser via this app's own code:

- **Input:** clicking the mic button (shown only in vocal mode, next to the attach button)
  creates a `window.SpeechRecognition` (or `webkitSpeechRecognition`) instance, `lang:
  'fr-FR'`, and appends the recognized transcript into the existing `input` state — it's
  dictation into the same text field, not a separate voice-only send path.
- **Output:** an effect watches the `isStreaming` → `false` transition (guarded by
  `wasStreamingRef` so it never fires on mount/history load) and, only when `voiceMode ===
  'vocal'`, speaks the last assistant message via `window.speechSynthesis` +
  `SpeechSynthesisUtterance`.

Leaving vocal mode stops any in-flight recognition and cancels any in-flight speech
(a dedicated effect keyed on `voiceMode`), so switching back to text mode can't leave a mic
listening or a reply talking in the background.

## Alternatives Considered

- **Server-side STT/TTS** (e.g. proxy audio to a Whisper/Piper container) — rejected: would
  add a new backend dependency and a new always-on service to the homelab for a feature the
  browser already provides for free, and would contradict the "no chat backend in the path"
  posture from ADR-0005.
- **A third-party STT/TTS JS library** — rejected: same reasoning as ADR-0004's rejection of
  a theming library — the native browser API already does exactly this, so a library would
  add a dependency to wrap an API that's a few lines to call directly.
- **A separate "speak" button per message** instead of auto-speaking on stream end —
  rejected: the point of vocal mode is a hands-free loop (speak → hear reply → speak again);
  requiring a manual click after every reply defeats that.

## Consequences

- ✅ Zero new dependencies; the whole feature is native browser APIs plus existing state
  patterns (`loadVoiceMode()` mirrors `loadTheme()`).
- ✅ Nothing about the existing text-mode UX or the request path changes — voice mode is
  additive and fully reversible via the same dropdown.
- ⚠️ `SpeechRecognition` (unprefixed) has no Firefox support as of this writing; only
  `webkitSpeechRecognition` (Chromium-based browsers) reliably works. Text mode remains the
  fallback with no separate feature-detection UI beyond the error banner shown if neither
  constructor exists.
- ⚠️ Recognition and synthesis language is hardcoded to `'fr-FR'` to match the rest of the
  UI's copy — there's no language picker, so this breaks for a non-French speaker without a
  code change.
- ⚠️ Auto-speaking on every streamed reply means a long reply is read in full with no
  pause/skip control beyond leaving vocal mode entirely.
