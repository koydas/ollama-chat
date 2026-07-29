# ADR-0013: Prime the shared `<audio>` element inside click handlers to survive autoplay policy

- **Date:** 2026-07-29
- **Status:** Accepted

## Context

Vocal mode auto-plays the assistant's reply through Piper TTS once streaming finishes
(ADR-0011). In production this failed intermittently with:

```
Erreur de synthèse vocale : The request is not allowed by the user agent or the platform in
the current context, possibly because the user denied permission.
```

That's Chrome's `NotAllowedError` for `HTMLMediaElement.play()`, thrown by its autoplay
policy. The playback call happens at the end of an async chain — stop dictation → `/api/stt`
→ `/api/chat` streaming (can take several seconds) → `/api/tts` → `audio.play()` — well past
the point Chrome still credits as "close enough" to the click that started it. Chrome mostly
gates this on Media Engagement Index (has this origin successfully played audio from a real
gesture before?), which a freshly-visited single-user LAN app has none of.

Server logs bore this out: Piper had served TTS requests successfully throughout earlier
testing (the *fetch* always worked — that's a network call, unaffected by autoplay policy),
but the client-side `audio.play()` was silently rejected, which the existing `catch` surfaced
as the error banner above. This was hard to diagnose remotely — the browser-side rejection
leaves no trace in any server log, since the HTTP round-trip for the audio bytes had already
succeeded.

## Decision

Play a silent WAV (`SILENT_WAV`, a minimal base64 data URI) on the shared `audioPlayerRef`
element synchronously inside the two real user-gesture handlers — `handleMicClick`'s stop
branch and `handleSend` — via a small `unlockAudioPlayback()` helper:

```js
audio.src = SILENT_WAV
audio.play().then(() => audio.pause()).catch(() => {})
```

Once an element has successfully played due to a genuine click, browsers permit continued
programmatic `play()` calls on *that same element* later in the page's life without requiring
a fresh gesture — the standard "audio unlock" pattern used by games and voice-assistant-style
web apps. `speakText()` (both the manual per-message 🔊 button and the auto-play effect) keeps
reusing this same `<audio>` element, so once it's unlocked by either send path, both the
manual and automatic playback keep working for the rest of the session.

The unlock call is placed in the click handlers themselves, not inside `sendMessage()` — the
mic-dictation path calls `sendMessage()` from `MediaRecorder.onstop`, an async callback that
no longer carries gesture context by the time it fires. Only the code running synchronously
inside the actual `onClick`/`onSubmit` counts as "in response to a user gesture."

## Alternatives Considered

- **Unlock once on first page interaction (e.g. a global `click` listener)** — rejected:
  works for the manual 🔊 button but the auto-play path is the one that actually needs it, and
  tying the unlock to the specific gesture that starts each send/dictation flow is no more
  code and doesn't depend on the user having clicked anything unrelated first.
- **Prompt the user to "enable audio" once, store the choice** — rejected: an extra
  interaction step for what should be a transparent detail; the silent-clip trick achieves the
  same unlock invisibly.
- **Drop auto-play, require the manual 🔊 tap on every reply** — rejected: defeats the point of
  vocal mode (hands-free back-and-forth), and the manual button chain (`await fetch` before
  `play()`) is exposed to the exact same policy on stricter engines (notably iOS Safari)
  regardless.

## Consequences

- ✅ Auto-play and the manual 🔊 button both keep working after the first send/dictation of a
  session, with no visible change for the user beyond the reply audibly playing.
- ⚠️ Relies on browser-specific autoplay heuristics that aren't formally standardized —
  behavior could still vary across engines (e.g. iOS Safari is stricter about *how* the prior
  play() must relate to later ones). If reports of the same error resurface on a specific
  browser, that engine's exact activation rules are the next thing to check.
- ⚠️ `unlockAudioPlayback()` must stay wired into every new entry point that can lead to
  `speakText()` firing without a fresh gesture of its own — a future feature that plays TTS
  from, say, a timer or a WebSocket push would need the same treatment (or its own gesture).
