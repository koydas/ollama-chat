import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { CHAT_MODE_KEY, CLAUDE_MODEL, CONVERSATIONS_KEY, PROFILE_NAME_KEY, THEME_KEY } from './lib/conversations'

class FakeMediaRecorder {
  constructor(stream) {
    this.stream = stream
    FakeMediaRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['fake-audio']) })
    this.onstop?.()
  }
}
FakeMediaRecorder.instances = []

const MODELS_RESPONSE = {
  models: [
    { name: 'qwen2.5-coder:7b-instruct-q4_0' },
    { name: 'llama3.1:8b-instruct-q4_0' },
    { name: 'qwen2.5:0.5b' },
  ],
}

function streamResponse(chunks) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

function mockFetch({ chatChunks, claudeChunks, sttText } = {}) {
  return vi.fn((url) => {
    if (url === '/api/tags') {
      return Promise.resolve(new Response(JSON.stringify(MODELS_RESPONSE), { status: 200 }))
    }
    if (url === '/api/chat') {
      return Promise.resolve(streamResponse(chatChunks ?? ['{"message":{"content":"Bonjour"}}\n']))
    }
    if (url === '/api/claude-chat') {
      return Promise.resolve(streamResponse(claudeChunks ?? ['{"message":{"content":"Bonjour"}}\n']))
    }
    if (typeof url === 'string' && url.startsWith('/api/stt')) {
      return Promise.resolve(
        new Response(JSON.stringify({ text: sttText ?? 'bonjour tout le monde' }), { status: 200 }),
      )
    }
    if (url === '/api/tts') {
      return Promise.resolve(new Response(new Blob(['fake-wav'], { type: 'audio/wav' }), { status: 200 }))
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

// jsdom has no real image decoder, so a real `Image().onload` never fires
// for these tests' fake file bytes — stub it to fail fast via `onerror`
// (resizeImageDataUrl falls back to the original data URL) rather than
// waiting out its safety-net timeout on every test that attaches a file.
class FakeImage {
  set src(value) {
    this._src = value
    queueMicrotask(() => this.onerror?.())
  }
  get src() {
    return this._src
  }
}

beforeEach(() => {
  localStorage.clear()
  FakeMediaRecorder.instances.length = 0
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  vi.stubGlobal('Image', FakeImage)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }) },
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('shows the header mode selector defaulting to Chat, no model picker', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<App />)

    await screen.findByText('Chat')
    const modeSelect = screen.getByRole('combobox', { name: 'Mode' })
    expect(modeSelect).toHaveValue('text')
    expect(screen.getByRole('option', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Vocal' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Claude' })).toBeInTheDocument()
  })

  it('sends a message and displays the streamed assistant reply, using the text model', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      chatChunks: ['{"message":{"content":"Bonjour"}}\n', '{"message":{"content":" !"}}\n'],
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await screen.findByText('Chat')
    await user.type(screen.getByPlaceholderText('Type a message...'), 'salut')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('salut')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Bonjour !')).toBeInTheDocument())

    const chatCall = fetchMock.mock.calls.find((c) => c[0] === '/api/chat')
    expect(JSON.parse(chatCall[1].body).model).toBe('llama3.1:8b-instruct-q4_0')
  })

  it('creates a new conversation and keeps the old one in history', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockFetch({ chatChunks: ['{"message":{"content":"salut !"}}\n'] }))
    render(<App />)

    await screen.findByText('Chat')
    await user.type(screen.getByPlaceholderText('Type a message...'), 'premiere question')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByText('salut !')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(screen.queryByText('premiere question')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Historique des conversations' }))
    expect(screen.getByText('premiere question')).toBeInTheDocument()
  })

  it('switches to a past conversation from the history panel', async () => {
    const stored = [
      { id: 'a', title: 'Conversation A', messages: [{ role: 'user', content: 'question A' }], model: '', updatedAt: 1000 },
      { id: 'b', title: 'Conversation B', messages: [{ role: 'user', content: 'question B' }], model: '', updatedAt: 2000 },
    ]
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(stored))
    vi.stubGlobal('fetch', mockFetch())
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('Chat')
    expect(screen.getByText('question B')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Historique des conversations' }))
    await user.click(screen.getByText('Conversation A'))

    expect(screen.getByText('question A')).toBeInTheDocument()
    expect(screen.queryByText('question B')).not.toBeInTheDocument()
  })

  it('deletes a conversation from the history panel', async () => {
    const stored = [
      { id: 'a', title: 'Conversation A', messages: [{ role: 'user', content: 'question A' }], model: '', updatedAt: 1000 },
      { id: 'b', title: 'Conversation B', messages: [{ role: 'user', content: 'question B' }], model: '', updatedAt: 2000 },
    ]
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(stored))
    vi.stubGlobal('fetch', mockFetch())
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('Chat')
    await user.click(screen.getByRole('button', { name: 'Historique des conversations' }))
    // Sorted by most recent first: "Conversation B" is first, "Conversation A" second.
    const deleteButtons = screen.getAllByRole('button', { name: 'Supprimer la conversation' })
    await user.click(deleteButtons[0])

    await waitFor(() => {
      const remaining = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY))
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe('a')
    })
  })

  it('recovers from a localStorage quota error by stripping old images, keeping text', async () => {
    const stored = [
      {
        id: 'a',
        title: 'Chat photo',
        updatedAt: 1000,
        messages: [
          { role: 'user', content: 'une vieille photo', images: ['data:image/jpeg;base64,AAAA'] },
        ],
      },
    ]
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(stored))

    const realSetItem = Storage.prototype.setItem.bind(localStorage)
    let quotaHit = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      if (key === CONVERSATIONS_KEY && !quotaHit) {
        quotaHit = true
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
      realSetItem(key, value)
    })

    vi.stubGlobal('fetch', mockFetch())
    render(<App />)

    await screen.findByText('Chat')
    expect(await screen.findByText(/Stockage local plein/)).toBeInTheDocument()
    expect(screen.getByText('une vieille photo [Image]')).toBeInTheDocument()

    const saved = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY))
    expect(saved[0].messages[0].images).toBeUndefined()
    expect(saved[0].messages[0].content).toBe('une vieille photo [Image]')
  })

  it('edits a user message, drops the old reply and regenerates it', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((url, opts) => {
      if (url === '/api/tags') {
        return Promise.resolve(new Response(JSON.stringify(MODELS_RESPONSE), { status: 200 }))
      }
      if (url === '/api/chat') {
        const { messages } = JSON.parse(opts.body)
        const reply = messages[messages.length - 1].content === 'salut corrigé' ? 'nouvelle réponse' : 'Bonjour'
        return Promise.resolve(streamResponse([`{"message":{"content":"${reply}"}}\n`]))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await screen.findByText('Chat')
    await user.type(screen.getByPlaceholderText('Type a message...'), 'salut')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByText('Bonjour')).toBeInTheDocument())

    await user.click(screen.getAllByRole('button', { name: 'Modifier le message' })[0])
    const textarea = screen.getByDisplayValue('salut')
    await user.clear(textarea)
    await user.type(textarea, 'salut corrigé')
    await user.click(screen.getByRole('button', { name: 'Enregistrer et régénérer' }))

    expect(await screen.findByText('salut corrigé')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('nouvelle réponse')).toBeInTheDocument())
    expect(screen.queryByText('salut')).not.toBeInTheDocument()
    expect(screen.queryByText('Bonjour')).not.toBeInTheDocument()

    const chatCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/chat')
    expect(chatCalls).toHaveLength(2)
    expect(JSON.parse(chatCalls[1][1].body).messages).toEqual([{ role: 'user', content: 'salut corrigé' }])
  })

  it('edits an assistant message without triggering a new request', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ chatChunks: ['{"message":{"content":"Bonjour"}}\n'] })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await screen.findByText('Chat')
    await user.type(screen.getByPlaceholderText('Type a message...'), 'salut')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByText('Bonjour')).toBeInTheDocument())

    const editButtons = screen.getAllByRole('button', { name: 'Modifier le message' })
    await user.click(editButtons[1])
    const textarea = screen.getByDisplayValue('Bonjour')
    await user.clear(textarea)
    await user.type(textarea, 'Bonjour corrigé')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    expect(await screen.findByText('Bonjour corrigé')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/chat')).toHaveLength(1)
  })

  it('attaches an image and sends it as base64 in the chat request', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ chatChunks: ['{"message":{"content":"Une photo de chat"}}\n'] })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await screen.findByText('Chat')

    const file = new File(['fake-image-bytes'], 'chat.png', { type: 'image/png' })
    const fileInput = document.querySelector('input[type="file"]')
    await user.upload(fileInput, file)

    await screen.findByAltText('')
    await user.type(screen.getByPlaceholderText('Type a message...'), "qu'est-ce que c'est ?")
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText('Une photo de chat')).toBeInTheDocument())

    const chatCall = fetchMock.mock.calls.find((c) => c[0] === '/api/chat')
    const body = JSON.parse(chatCall[1].body)
    const sentMessage = body.messages[0]
    expect(sentMessage.content).toBe("qu'est-ce que c'est ?")
    expect(sentMessage.images).toHaveLength(1)
    expect(sentMessage.images[0]).not.toMatch(/^data:/)
    expect(body.model).toBe('llava:7b')
  })

  it('shows an error banner when Ollama cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    )
    render(<App />)

    expect(await screen.findByText(/Could not reach Ollama/)).toBeInTheDocument()
  })
})

describe('profile', () => {
  it('renames the profile and persists it to localStorage', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockFetch())
    render(<App />)

    await screen.findByText('Chat')
    await user.click(screen.getByRole('button', { name: 'Historique des conversations' }))
    await user.click(screen.getByRole('button', { name: 'Profil' }))

    const nameInput = screen.getByDisplayValue('Vous')
    await user.clear(nameInput)
    await user.type(nameInput, 'Sam')

    await waitFor(() => expect(localStorage.getItem(PROFILE_NAME_KEY)).toBe('Sam'))
    expect(screen.getByText('Sam')).toBeInTheDocument()
  })

  it('applies the chosen theme to the document root', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockFetch())
    render(<App />)

    await screen.findByText('Chat')
    await user.click(screen.getByRole('button', { name: 'Historique des conversations' }))
    await user.click(screen.getByRole('button', { name: 'Profil' }))

    await user.selectOptions(screen.getByDisplayValue('Système'), 'dark')

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  it('clears every conversation from the profile menu', async () => {
    const stored = [
      { id: 'a', title: 'Conversation A', messages: [{ role: 'user', content: 'question A' }], model: '', updatedAt: 1000 },
    ]
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(stored))
    vi.stubGlobal('fetch', mockFetch())
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<App />)

    await screen.findByText('Chat')
    expect(screen.getByText('question A')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Historique des conversations' }))
    await user.click(screen.getByRole('button', { name: 'Profil' }))
    await user.click(screen.getByRole('button', { name: 'Effacer toutes les conversations' }))

    await waitFor(() => {
      const remaining = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY))
      expect(remaining).toHaveLength(1)
      expect(remaining[0].messages).toEqual([])
    })
    expect(screen.queryByText('question A')).not.toBeInTheDocument()
  })
})

describe('voice mode', () => {
  async function switchToVocal(user) {
    await screen.findByText('Chat')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Mode' }), 'vocal')
  }

  it('shows a mic button only once the header mode is set to Vocal, and persists the choice', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockFetch())
    render(<App />)

    await screen.findByText('Chat')
    expect(screen.queryByRole('button', { name: 'Dicter un message' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Mode' }), 'vocal')

    expect(screen.getByRole('button', { name: 'Dicter un message' })).toBeInTheDocument()
    expect(localStorage.getItem(CHAT_MODE_KEY)).toBe('vocal')
  })

  it('swaps the mic icon for the send icon once text is typed, and back once cleared', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockFetch())
    render(<App />)
    await switchToVocal(user)

    expect(screen.getByRole('button', { name: 'Dicter un message' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Type a message...'), 'salut')
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dicter un message' })).not.toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText('Type a message...'))
    expect(screen.getByRole('button', { name: 'Dicter un message' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it('dictates a message via MediaRecorder + /api/stt and sends it automatically', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await switchToVocal(user)

    await user.click(screen.getByRole('button', { name: 'Dicter un message' }))
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Arrêter la dictée' })).toBeInTheDocument()

    act(() => {
      FakeMediaRecorder.instances[0].stop()
    })

    expect(await screen.findByText('bonjour tout le monde')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type a message...')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Dicter un message' })).toBeInTheDocument()

    const sttCall = fetchMock.mock.calls.find((c) => typeof c[0] === 'string' && c[0].startsWith('/api/stt'))
    expect(sttCall).toBeTruthy()
    expect(sttCall[1].body).toBeInstanceOf(FormData)

    const chatCall = fetchMock.mock.calls.find((c) => c[0] === '/api/chat')
    expect(chatCall).toBeTruthy()
  })

  it('shows an error banner and does not send when dictation returns no speech', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ sttText: '' })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await switchToVocal(user)

    await user.click(screen.getByRole('button', { name: 'Dicter un message' }))
    await waitFor(() => expect(FakeMediaRecorder.instances).toHaveLength(1))

    act(() => {
      FakeMediaRecorder.instances[0].stop()
    })

    expect(await screen.findByText('Aucune parole détectée, réessayez.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/chat')).toBe(false)
  })

  it('shows an error banner when the microphone is not accessible', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockFetch())
    render(<App />)
    await switchToVocal(user)
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(new Error('denied'))

    await user.click(screen.getByRole('button', { name: 'Dicter un message' }))

    expect(await screen.findByText(/microphone n'est pas accessible/)).toBeInTheDocument()
  })

  it('plays the synthesized reply once streaming finishes', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      chatChunks: ['{"message":{"content":"Bonjour"}}\n', '{"message":{"content":" !"}}\n'],
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await switchToVocal(user)

    await user.type(screen.getByPlaceholderText('Type a message...'), 'salut')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())

    const ttsCall = fetchMock.mock.calls.find((c) => c[0] === '/api/tts')
    expect(JSON.parse(ttsCall[1].body)).toEqual({ text: 'Bonjour !' })
  })

  it('skips auto-play when "Lire les réponses à voix haute" is turned off', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ chatChunks: ['{"message":{"content":"Bonjour"}}\n'] })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await switchToVocal(user)

    await user.click(screen.getByRole('button', { name: 'Historique des conversations' }))
    await user.click(screen.getByRole('button', { name: 'Profil' }))
    await user.click(screen.getByLabelText('Lire les réponses à voix haute (mode vocal)'))

    await user.type(screen.getByPlaceholderText('Type a message...'), 'salut')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(screen.getByText('Bonjour')).toBeInTheDocument())
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/tts')).toBe(false)
  })

  it('does not call /api/tts when back in text mode', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ chatChunks: ['{"message":{"content":"Bonjour"}}\n'] })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await screen.findByText('Chat')
    await user.type(screen.getByPlaceholderText('Type a message...'), 'salut')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(screen.getByText('Bonjour')).toBeInTheDocument())

    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/tts')).toBe(false)
  })
})

describe('Claude mode', () => {
  it('sends a message to /api/claude-chat instead of /api/chat, using CLAUDE_MODEL and Claude-shaped content', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({ claudeChunks: ['{"message":{"content":"Bonjour"}}\n', '{"message":{"content":" !"}}\n'] })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    await screen.findByText('Chat')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Mode' }), 'claude')
    await user.type(screen.getByPlaceholderText('Type a message...'), 'salut')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('salut')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Bonjour !')).toBeInTheDocument())

    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/chat')).toBe(false)
    const claudeCall = fetchMock.mock.calls.find((c) => c[0] === '/api/claude-chat')
    const body = JSON.parse(claudeCall[1].body)
    expect(body.model).toBe(CLAUDE_MODEL)
    expect(body.messages).toEqual([{ role: 'user', content: 'salut' }])
  })

  it('persists the Claude mode choice and shows no mic button (it is not a voice mode)', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockFetch())
    render(<App />)

    await screen.findByText('Chat')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Mode' }), 'claude')

    expect(localStorage.getItem(CHAT_MODE_KEY)).toBe('claude')
    expect(screen.queryByRole('button', { name: 'Dicter un message' })).not.toBeInTheDocument()
  })
})
