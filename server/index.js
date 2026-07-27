import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'session.json')

const app = express()
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

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Session server listening on :${PORT}`))
