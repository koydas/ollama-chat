import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProxyMiddleware } from 'http-proxy-middleware'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'session.json')
const DIST_DIR = path.join(__dirname, '..', 'dist')

// In-cluster Ollama service (see gitops-homelab). Only used when this server
// fronts the built static app in production — local dev talks to Ollama via
// Vite's own proxy instead, so this route is dormant under `npm run dev:all`.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama.ollama.svc.cluster.local:11434'

const app = express()

app.use(
  '/api',
  createProxyMiddleware({
    target: OLLAMA_URL,
    changeOrigin: true,
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('origin', OLLAMA_URL)
      },
    },
  }),
)

app.use(express.json({ limit: '5mb' }))

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

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Session server listening on :${PORT}`))
