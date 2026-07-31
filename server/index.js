import Anthropic from '@anthropic-ai/sdk'
import express from 'express'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProxyMiddleware } from 'http-proxy-middleware'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Overridable so tests can point session persistence at a throwaway
// directory instead of writing into this repo's real server/data/.
const DATA_DIR = process.env.SESSION_DATA_DIR || path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'session.json')
const DIST_DIR = path.join(__dirname, '..', 'dist')

// In-cluster services (see gitops-homelab). Only used when this server fronts
// the built static app in production — local dev talks to them via Vite's own
// proxy instead, so these routes are dormant under `npm run dev:all`.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama.ollama.svc.cluster.local:11434'
const WHISPER_URL = process.env.WHISPER_URL || 'http://whisper.whisper.svc.cluster.local:9000'
const PIPER_URL = process.env.PIPER_URL || 'http://piper.piper.svc.cluster.local:8000'
// Unlike the three above, this always defaults to homelab-gateway, never
// straight to Anthropic — this app holds no Anthropic credential of its
// own (see ADR-0019, and homelab-gateway's ADR-0004 for why the gateway
// holds it instead), so a direct-to-Anthropic fallback would just fail.
const CLAUDE_URL = process.env.CLAUDE_URL || 'http://homelab-gateway.homelab-gateway.svc.cluster.local:80'
// Hard cap on thinking + response tokens combined (Claude Opus 5 runs
// adaptive thinking by default) — generous enough that a normal chat
// question isn't truncated mid-thought, without leaving cost unbounded.
const CLAUDE_MAX_TOKENS = 8192

const app = express()

// /api/stt and /api/tts are registered before the general /api proxy below,
// since that one matches by prefix and would otherwise swallow these first.
app.use(
  createProxyMiddleware({
    pathFilter: '/api/stt',
    target: WHISPER_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/stt': '/asr' },
  }),
)

app.use(
  createProxyMiddleware({
    pathFilter: '/api/tts',
    target: PIPER_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/tts': '/tts' },
  }),
)

// Registered before the generic /api proxy below (same reason as
// /api/stt and /api/tts): that proxy's pathFilter would otherwise swallow
// this route too. Unlike the Ollama/Whisper/Piper proxies, this isn't a
// passthrough -- it re-shapes Anthropic's SSE stream into the same NDJSON
// delta shape Ollama already sends (`{"message":{"content":"..."}}\n` per
// chunk), so the frontend's streamReply() needs no per-provider parsing
// branch. express.json() is scoped to just this route, not applied
// globally before it, since the passthrough proxies above need the raw
// request stream untouched. See ADR-0019.
app.post('/api/claude-chat', express.json({ limit: '25mb' }), async (req, res) => {
  // No ANTHROPIC_API_KEY here -- @anthropic-ai/sdk requires a non-empty
  // string to construct, but the real credential lives on homelab-gateway
  // (ADR-0019), which overwrites this placeholder with the real key before
  // forwarding to Anthropic. If CLAUDE_URL were ever pointed elsewhere
  // (e.g. Anthropic directly), every call would 401 -- by design, since
  // this app is never meant to hold that credential itself.
  const anthropic = new Anthropic({ apiKey: 'placeholder-gateway-injects-the-real-key', baseURL: CLAUDE_URL })

  try {
    const stream = anthropic.messages.stream({
      model: req.body.model,
      max_tokens: CLAUDE_MAX_TOKENS,
      messages: req.body.messages,
    })

    res.setHeader('Content-Type', 'application/x-ndjson')
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`${JSON.stringify({ message: { content: event.delta.text } })}\n`)
      }
    }
    res.end()
  } catch (err) {
    // A failure mid-stream has already sent headers (and possibly partial
    // NDJSON lines) -- there's no valid response left to send but a plain
    // end(), same as an aborted Ollama stream would leave the client with.
    if (res.headersSent) {
      res.end()
    } else {
      res.status(502).json({ error: `Claude request failed: ${err.message}` })
    }
  }
})

// Mounted at the app root (not app.use('/api', ...)) with pathFilter instead:
// Express strips the mount path from req.url, which would forward requests
// to Ollama with the /api prefix missing (e.g. /api/tags -> /tags -> 404).
app.use(
  createProxyMiddleware({
    pathFilter: '/api',
    target: OLLAMA_URL,
    changeOrigin: true,
    on: {
      // Ollama enforces an Origin allowlist (DNS-rebinding protection) and
      // rejects anything that isn't same-origin with itself; changeOrigin
      // only rewrites Host, not Origin. Regression-tested in
      // server/index.e2e.test.js — see ADR-0017.
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('origin', OLLAMA_URL)
      },
    },
  }),
)

// 25mb to comfortably fit synced conversations containing base64-encoded
// image attachments (a single photo can be several MB once base64-encoded).
app.use(express.json({ limit: '25mb' }))

app.get('/session', (req, res) => {
  if (!fs.existsSync(DATA_FILE)) return res.json(null)
  try {
    res.json(JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')))
  } catch {
    res.status(500).json({ error: 'Corrupted session data' })
  }
})

app.put('/session', (req, res) => {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(DATA_FILE, JSON.stringify(req.body, null, 2))
  res.json({ ok: true })
})

// Serves the Vite production build (dist/) when present, so this same
// process can run standalone in the container image. Absent in local dev,
// where the frontend is served by the Vite dev server instead.
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.use((req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')))
}

// Guarded so importing this module from tests doesn't also bind real ports
// -- only bind when run directly, the way the Docker CMD and `npm run
// server` do.
if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = process.env.PORT || 3001
  app.listen(PORT, () => console.log(`Session server listening on :${PORT}`))

  // TLS for the direct MetalLB IP path (ADR-0007) — ollama-chat.home's own
  // TLS is terminated by ingress-nginx instead, so this is the only place
  // the bare IP gets HTTPS. Vocal mode's mic access needs a secure context
  // either way (see docs/adr/0012), and the bare IP has no /etc/hosts
  // requirement, so it needs its own cert (same self-signed cert, with an
  // IP SAN added). Only starts when a cert is actually mounted, so local
  // dev/tests are unaffected.
  const TLS_CERT_PATH = process.env.TLS_CERT_PATH || '/app/certs/tls.crt'
  const TLS_KEY_PATH = process.env.TLS_KEY_PATH || '/app/certs/tls.key'
  const HTTPS_PORT = process.env.HTTPS_PORT || 8443

  if (fs.existsSync(TLS_CERT_PATH) && fs.existsSync(TLS_KEY_PATH)) {
    https
      .createServer({ cert: fs.readFileSync(TLS_CERT_PATH), key: fs.readFileSync(TLS_KEY_PATH) }, app)
      .listen(HTTPS_PORT, () => console.log(`Session server (HTTPS) listening on :${HTTPS_PORT}`))
  }
}

export default app
