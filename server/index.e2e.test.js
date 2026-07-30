// @vitest-environment node
//
// End-to-end suite for the Express session server (server/index.js): a real
// app instance, real HTTP proxying, and three fake backends standing in for
// Ollama/Whisper/Piper -- no jsdom, no mocked fetch (contrast with
// src/App.test.jsx, which tests the React app in isolation with fetch
// stubbed). Run alongside the rest of the suite via `npm test`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

let app, server, baseUrl, sessionDir
let ollamaFake, whisperFake, piperFake

function createFakeBackend() {
  let handler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{}')
  }
  const httpServer = http.createServer((req, res) => handler(req, res))
  return {
    setHandler: (fn) => {
      handler = fn
    },
    listen: () =>
      new Promise((resolve) => {
        httpServer.listen(0, '127.0.0.1', () => resolve(httpServer.address().port))
      }),
    close: () => new Promise((resolve) => httpServer.close(resolve)),
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
  })
}

beforeAll(async () => {
  ollamaFake = createFakeBackend()
  whisperFake = createFakeBackend()
  piperFake = createFakeBackend()
  const ollamaPort = await ollamaFake.listen()
  const whisperPort = await whisperFake.listen()
  const piperPort = await piperFake.listen()

  sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-test-'))

  process.env.OLLAMA_URL = `http://127.0.0.1:${ollamaPort}`
  process.env.WHISPER_URL = `http://127.0.0.1:${whisperPort}`
  process.env.PIPER_URL = `http://127.0.0.1:${piperPort}`
  process.env.SESSION_DATA_DIR = sessionDir

  // Import after env vars are set -- the module reads its config from
  // process.env at top-level, once, on first import.
  ;({ default: app } = await import('./index.js'))

  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  await Promise.all([ollamaFake.close(), whisperFake.close(), piperFake.close()])
  fs.rmSync(sessionDir, { recursive: true, force: true })
})

describe('Ollama proxy (/api)', () => {
  it('proxies through to Ollama, path and body intact', async () => {
    ollamaFake.setHandler(async (req, res) => {
      const body = await readBody(req)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ url: req.url, body: JSON.parse(body || '{}') }))
    })

    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3.1:8b-instruct-q4_0', messages: [] }),
    })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.url).toBe('/api/chat')
    expect(json.body.model).toBe('llama3.1:8b-instruct-q4_0')
  })

  it('rewrites Origin to Ollama\'s own URL regardless of what the client sent (DNS-rebinding allowlist)', async () => {
    let seenOrigin
    ollamaFake.setHandler(async (req, res) => {
      seenOrigin = req.headers.origin
      await readBody(req)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{}')
    })

    await fetch(`${baseUrl}/api/tags`, {
      headers: { Origin: 'http://this-should-never-reach-ollama.example' },
    })
    expect(seenOrigin).toBe(process.env.OLLAMA_URL)
  })
})

describe('Whisper proxy (/api/stt)', () => {
  it('rewrites the path to /asr and forwards the request', async () => {
    let seenUrl
    whisperFake.setHandler(async (req, res) => {
      seenUrl = req.url
      await readBody(req)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ text: 'bonjour' }))
    })

    const res = await fetch(`${baseUrl}/api/stt`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: Buffer.from([1, 2, 3]),
    })
    expect(res.status).toBe(200)
    expect(seenUrl).toBe('/asr')
    expect((await res.json()).text).toBe('bonjour')
  })
})

describe('Piper proxy (/api/tts)', () => {
  it('rewrites the path to /tts and forwards the request', async () => {
    let seenUrl, seenBody
    piperFake.setHandler(async (req, res) => {
      seenUrl = req.url
      seenBody = JSON.parse(await readBody(req))
      res.writeHead(200, { 'Content-Type': 'audio/wav' })
      res.end(Buffer.from([0, 1, 2]))
    })

    const res = await fetch(`${baseUrl}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'bonjour le monde' }),
    })
    expect(res.status).toBe(200)
    expect(seenUrl).toBe('/tts')
    expect(seenBody.text).toBe('bonjour le monde')
  })
})

describe('Session sync (/session)', () => {
  it('returns null when no session has been saved yet', async () => {
    const res = await fetch(`${baseUrl}/session`)
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('round-trips a PUT through to a subsequent GET, persisted to SESSION_DATA_DIR', async () => {
    const payload = { conversations: [{ id: '1', title: 'Test' }] }

    const put = await fetch(`${baseUrl}/session`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(put.status).toBe(200)

    const get = await fetch(`${baseUrl}/session`)
    expect(await get.json()).toEqual(payload)

    // Confirms it actually landed on disk under the overridden data dir,
    // not just cached in memory somewhere.
    const onDisk = JSON.parse(fs.readFileSync(path.join(sessionDir, 'session.json'), 'utf-8'))
    expect(onDisk).toEqual(payload)
  })

  it('returns 500 for a corrupted session file instead of crashing', async () => {
    fs.writeFileSync(path.join(sessionDir, 'session.json'), '{ not valid json')

    const res = await fetch(`${baseUrl}/session`)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toMatch(/corrupted/i)
  })
})
