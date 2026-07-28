import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { CONVERSATIONS_KEY, PROFILE_NAME_KEY, THEME_KEY } from './lib/conversations'

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

function mockFetch({ chatChunks } = {}) {
  return vi.fn((url) => {
    if (url === '/api/tags') {
      return Promise.resolve(new Response(JSON.stringify(MODELS_RESPONSE), { status: 200 }))
    }
    if (url === '/api/chat') {
      return Promise.resolve(streamResponse(chatChunks ?? ['{"message":{"content":"Bonjour"}}\n']))
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`))
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('loads the model list and selects llama by default', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<App />)

    const select = await screen.findByRole('combobox')
    await waitFor(() => expect(select.value).toBe('llama3.1:8b-instruct-q4_0'))
    expect(within(select).getAllByRole('option')).toHaveLength(3)
  })

  it('sends a message and displays the streamed assistant reply', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      mockFetch({ chatChunks: ['{"message":{"content":"Bonjour"}}\n', '{"message":{"content":" !"}}\n'] }),
    )
    render(<App />)

    await screen.findByRole('combobox')
    await user.type(screen.getByPlaceholderText('Type a message...'), 'salut')
    await user.click(screen.getByRole('button', { name: 'Send' }))

    expect(await screen.findByText('salut')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Bonjour !')).toBeInTheDocument())
  })

  it('creates a new conversation and keeps the old one in history', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', mockFetch({ chatChunks: ['{"message":{"content":"salut !"}}\n'] }))
    render(<App />)

    await screen.findByRole('combobox')
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

    await screen.findByRole('combobox')
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

    await screen.findByRole('combobox')
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

    await screen.findByRole('combobox')
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

    await screen.findByRole('combobox')
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

    await screen.findByRole('combobox')
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

    await screen.findByRole('combobox')
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

    await screen.findByRole('combobox')
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
