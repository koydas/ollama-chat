# ADR-0011: Server-side Whisper/Piper replace the Web Speech API for voice mode

- **Date:** 2026-07-28
- **Status:** Accepted

## Context

ADR-0010 shipped voice mode entirely on the browser's native Web Speech API
(`SpeechRecognition`/`webkitSpeechRecognition` for dictation, `speechSynthesis` for reading
replies aloud), explicitly rejecting server-side STT/TTS at the time to avoid a new backend
dependency. That ADR's own "Negative" consequences flagged the two things that motivated
revisiting it: `SpeechRecognition` (unprefixed) has no Firefox support at all, and both APIs
are implemented however each browser vendor chooses — for Chromium this typically means
speech recognition round-trips through a Google-operated cloud service, not something that
runs self-hosted or works offline. The operator wants voice mode to work independent of
browser vendor and without any third-party cloud dependency.

## Decision

Voice mode now calls two self-hosted services deployed in the homelab cluster — Whisper
(speech-to-text) and Piper (text-to-speech) — through this app's own Express backend, the
same way it already proxies chat requests to Ollama. See
[`gitops-homelab`'s ADR-0016](https://github.com/koydas/gitops-homelab/blob/main/docs/adr/0016-onboard-whisper-piper-cpu-only.md)
for the cluster-side half of this decision (image choice, CPU-only constraint, deployment
pattern).

- **`server/index.js`** gets two new proxy blocks (`WHISPER_URL`, `PIPER_URL` env vars,
  defaulting to in-cluster Service DNS), registered before the existing `/api` → Ollama proxy
  since that one matches by prefix: `/api/stt` rewrites to Whisper's `/asr` endpoint,
  `/api/tts` rewrites to Piper's `/tts` endpoint. Both stay pure byte-stream proxies, no new
  body-parsing dependency, same philosophy as the existing Ollama proxy.
- **Input** (`handleMicClick` in `src/App.jsx`): the mic button now uses
  `navigator.mediaDevices.getUserMedia` + `MediaRecorder` to record, and on stop POSTs the
  audio blob as `multipart/form-data` (field `audio_file`) to
  `/api/stt?task=transcribe&language=fr&output=json`, putting the returned `text` into the
  existing `input` state — same integration point as before, just a different transcription
  source.
- **Output**: the effect watching the `isStreaming` → `false` transition now POSTs the
  assistant's reply as JSON to `/api/tts`, plays the returned `audio/wav` blob through a
  hidden `<audio>` element (`URL.createObjectURL`, revoked on `onended`), instead of calling
  `speechSynthesis`.
- The mode toggle itself also moved: the previously-static `.chat-badge` label in the header
  is now the interactive `<select>` (`Chat`/`Vocal`) driving `voiceMode`, and the redundant
  "Mode" row is removed from the profile menu. This is a UI relocation, not a new decision —
  `voiceMode`/`VOICE_MODE_KEY`/`loadVoiceMode()` from ADR-0010 are unchanged.

## Alternatives Considered

- **Keep the Web Speech API, add server-side as a fallback for Firefox only** — rejected:
  running two entirely different STT/TTS code paths (browser API vs. server proxy) roughly
  doubles the surface area to maintain and test for a feature that's supposed to reduce, not
  add, moving parts. A single server-side path works identically in every browser.
- **A commercial cloud STT/TTS API** (e.g. a hosted transcription service) — rejected: reintroduces
  the exact "not self-hosted, vendor-dependent" problem this ADR exists to solve, just with a
  different vendor; also adds a paid, internet-dependent component to a homelab tool that
  otherwise runs fully on local infrastructure.

## Consequences

- ✅ Voice mode now works identically in any browser that supports `MediaRecorder` and
  `getUserMedia` (broad support, unlike `SpeechRecognition`'s Chromium-only reality) and runs
  entirely on infrastructure the operator controls.
- ✅ Still no new dependency in `ollama-chat` itself — both new proxy routes are plain
  `createProxyMiddleware` blocks, same shape as the existing Ollama proxy.
- ⚠️ Voice mode now has a real availability dependency: if the `whisper` or `piper` pods are
  down, dictation/playback fail even though text chat still works fine (Ollama proxy is
  unaffected). This wasn't possible under ADR-0010's fully client-side design.
- ⚠️ Round-trip latency for both directions is now bounded by CPU-only inference on a shared
  homelab node (see `gitops-homelab` ADR-0016) rather than whatever the browser vendor's own
  (often hardware-accelerated) implementation provided — noticeably slower than the old
  Web Speech API path, traded for the self-hosting/offline properties this ADR exists for.
- ⚠️ Language is still hardcoded to French (`language=fr` on the STT call, the Piper voice is
  `fr_FR-siwis-medium`) — same limitation ADR-0010 already had, just moved to a different
  layer.
