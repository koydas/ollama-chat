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
let ollamaFake, whisperFake, piperFake, anthropicFake

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

// Anthropic's real SSE event framing for a streamed Messages API response,
// matching what the `@anthropic-ai/sdk` client parses -- see
// docs/streaming.md's "Raw SSE Format" in the claude-api skill.
function writeAnthropicSse(res, textDeltas) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  send('message_start', {
    type: 'message_start',
    message: { id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], usage: {} },
  })
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  for (const text of textDeltas) {
    send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  }
  send('content_block_stop', { type: 'content_block_stop', index: 0 })
  send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: textDeltas.length } })
  send('message_stop', { type: 'message_stop' })
  res.end()
}

beforeAll(async () => {
  ollamaFake = createFakeBackend()
  whisperFake = createFakeBackend()
  piperFake = createFakeBackend()
  anthropicFake = createFakeBackend()
  const ollamaPort = await ollamaFake.listen()
  const whisperPort = await whisperFake.listen()
  const piperPort = await piperFake.listen()
  const anthropicPort = await anthropicFake.listen()

  sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-chat-test-'))

  process.env.OLLAMA_URL = `http://127.0.0.1:${ollamaPort}`
  process.env.WHISPER_URL = `http://127.0.0.1:${whisperPort}`
  process.env.PIPER_URL = `http://127.0.0.1:${piperPort}`
  process.env.CLAUDE_URL = `http://127.0.0.1:${anthropicPort}`
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
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
  await Promise.all([ollamaFake.close(), whisperFake.close(), piperFake.close(), anthropicFake.close()])
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

describe('Claude proxy (/api/claude-chat)', () => {
  it('translates Anthropic SSE deltas into the same NDJSON shape /api/chat uses', async () => {
    let seenBody
    anthropicFake.setHandler(async (req, res) => {
      seenBody = JSON.parse(await readBody(req))
      writeAnthropicSse(res, ['Bonjour', ' !'])
    })

    const res = await fetch(`${baseUrl}/api/claude-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-opus-5',
        messages: [{ role: 'user', content: 'salut' }],
        stream: true,
      }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    const lines = text.trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toEqual([{ message: { content: 'Bonjour' } }, { message: { content: ' !' } }])

    expect(seenBody.model).toBe('claude-opus-5')
    expect(seenBody.messages).toEqual([{ role: 'user', content: 'salut' }])
  })

  it('forwards the caller\'s x-api-key using ANTHROPIC_API_KEY, not any client-supplied value', async () => {
    let seenApiKey
    anthropicFake.setHandler(async (req, res) => {
      seenApiKey = req.headers['x-api-key']
      writeAnthropicSse(res, ['ok'])
    })

    await fetch(`${baseUrl}/api/claude-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-opus-5', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(seenApiKey).toBe('sk-ant-test-key')
  })

  it('returns 500 without ever calling out when ANTHROPIC_API_KEY is not configured', async () => {
    let called = false
    anthropicFake.setHandler((req, res) => {
      called = true
      res.writeHead(200).end('{}')
    })
    const original = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const res = await fetch(`${baseUrl}/api/claude-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-opus-5', messages: [{ role: 'user', content: 'hi' }] }),
      })
      expect(res.status).toBe(500)
      expect(called).toBe(false)
    } finally {
      process.env.ANTHROPIC_API_KEY = original
    }
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
