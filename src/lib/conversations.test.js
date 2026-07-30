import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONVERSATIONS_KEY,
  DEFAULT_PROFILE_NAME,
  deriveTitle,
  formatRelativeTime,
  LEGACY_MESSAGES_KEY,
  loadConversations,
  loadProfileName,
  loadServerSync,
  loadTheme,
  loadVoiceMode,
  makeConversation,
  makeId,
  mostRecentId,
  pickModel,
  PROFILE_NAME_KEY,
  resizeImageDataUrl,
  SERVER_SYNC_KEY,
  stripImages,
  TEXT_MODEL,
  THEME_KEY,
  toOllamaMessage,
  VISION_MODEL,
  VOICE_MODE_KEY,
} from './conversations'

beforeEach(() => {
  localStorage.clear()
})

describe('makeId', () => {
  it('returns unique values', () => {
    const a = makeId()
    const b = makeId()
    expect(a).not.toBe(b)
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(0)
  })
})

describe('deriveTitle', () => {
  it('returns empty string when there is no user message', () => {
    expect(deriveTitle([])).toBe('')
    expect(deriveTitle([{ role: 'assistant', content: 'salut' }])).toBe('')
  })

  it('uses the first user message, trimmed and collapsed', () => {
    const messages = [{ role: 'user', content: '  bonjour   le monde  ' }]
    expect(deriveTitle(messages)).toBe('bonjour le monde')
  })

  it('truncates long titles to 42 chars with an ellipsis', () => {
    const longText = 'a'.repeat(60)
    const title = deriveTitle([{ role: 'user', content: longText }])
    expect(title).toBe(`${'a'.repeat(42)}…`)
  })

  it('ignores assistant messages that come before the first user message', () => {
    const messages = [
      { role: 'assistant', content: 'bonjour, comment puis-je aider ?' },
      { role: 'user', content: 'salut' },
    ]
    expect(deriveTitle(messages)).toBe('salut')
  })
})

describe('makeConversation', () => {
  it('creates an empty conversation', () => {
    const conv = makeConversation()
    expect(conv.title).toBe('')
    expect(conv.messages).toEqual([])
    expect(typeof conv.id).toBe('string')
    expect(typeof conv.updatedAt).toBe('number')
  })
})

describe('loadConversations', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(loadConversations()).toEqual([])
  })

  it('returns the stored conversations array as-is', () => {
    const stored = [{ id: '1', title: 'x', messages: [], model: '', updatedAt: 1 }]
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(stored))
    expect(loadConversations()).toEqual(stored)
  })

  it('ignores an empty stored array and falls back to []', () => {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify([]))
    expect(loadConversations()).toEqual([])
  })

  it('recovers from corrupt JSON in the conversations key', () => {
    localStorage.setItem(CONVERSATIONS_KEY, '{not json')
    expect(loadConversations()).toEqual([])
  })

  it('migrates legacy single-conversation messages into one conversation', () => {
    const legacyMessages = [
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: 'bonjour' },
    ]
    localStorage.setItem(LEGACY_MESSAGES_KEY, JSON.stringify(legacyMessages))

    const result = loadConversations()

    expect(result).toHaveLength(1)
    expect(result[0].messages).toEqual(legacyMessages)
    expect(result[0].title).toBe('salut')
    expect(localStorage.getItem(LEGACY_MESSAGES_KEY)).toBeNull()
  })

  it('removes the legacy key even if it contained no usable messages', () => {
    localStorage.setItem(LEGACY_MESSAGES_KEY, JSON.stringify([]))
    expect(loadConversations()).toEqual([])
    expect(localStorage.getItem(LEGACY_MESSAGES_KEY)).toBeNull()
  })

  it('prefers the new conversations key over the legacy one', () => {
    const stored = [{ id: '1', title: 'nouveau', messages: [], model: '', updatedAt: 1 }]
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(stored))
    localStorage.setItem(LEGACY_MESSAGES_KEY, JSON.stringify([{ role: 'user', content: 'ancien' }]))

    expect(loadConversations()).toEqual(stored)
  })
})

describe('mostRecentId', () => {
  it('returns null for an empty list', () => {
    expect(mostRecentId([])).toBeNull()
  })

  it('returns the id of the conversation with the highest updatedAt', () => {
    const conversations = [
      { id: 'a', updatedAt: 1000 },
      { id: 'b', updatedAt: 3000 },
      { id: 'c', updatedAt: 2000 },
    ]
    expect(mostRecentId(conversations)).toBe('b')
  })

  it('does not depend on array order', () => {
    const conversations = [
      { id: 'newest', updatedAt: 5000 },
      { id: 'oldest', updatedAt: 100 },
    ]
    expect(mostRecentId(conversations)).toBe('newest')
  })
})

describe('pickModel', () => {
  it('picks the text model when no message has images', () => {
    expect(pickModel([{ role: 'user', content: 'salut' }])).toBe(TEXT_MODEL)
  })

  it('picks the vision model when any message carries images', () => {
    const messages = [
      { role: 'user', content: 'salut' },
      { role: 'user', content: "qu'est-ce que c'est ?", images: ['data:image/png;base64,AAAA'] },
    ]
    expect(pickModel(messages)).toBe(VISION_MODEL)
  })

  it('treats an empty images array as no images', () => {
    expect(pickModel([{ role: 'user', content: 'salut', images: [] }])).toBe(TEXT_MODEL)
  })
})

describe('loadProfileName', () => {
  it('defaults to the generic profile name when nothing is stored', () => {
    expect(loadProfileName()).toBe(DEFAULT_PROFILE_NAME)
  })

  it('returns the stored profile name', () => {
    localStorage.setItem(PROFILE_NAME_KEY, 'Sam')
    expect(loadProfileName()).toBe('Sam')
  })
})

describe('loadTheme', () => {
  it('defaults to system', () => {
    expect(loadTheme()).toBe('system')
  })

  it('returns light or dark when stored', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    expect(loadTheme()).toBe('dark')
    localStorage.setItem(THEME_KEY, 'light')
    expect(loadTheme()).toBe('light')
  })

  it('falls back to system for an invalid stored value', () => {
    localStorage.setItem(THEME_KEY, 'not-a-theme')
    expect(loadTheme()).toBe('system')
  })
})

describe('loadServerSync', () => {
  it('defaults to false', () => {
    expect(loadServerSync()).toBe(false)
  })

  it('returns true only when stored as the string "true"', () => {
    localStorage.setItem(SERVER_SYNC_KEY, 'true')
    expect(loadServerSync()).toBe(true)
    localStorage.setItem(SERVER_SYNC_KEY, 'false')
    expect(loadServerSync()).toBe(false)
  })
})

describe('loadVoiceMode', () => {
  it('defaults to text', () => {
    expect(loadVoiceMode()).toBe('text')
  })

  it('returns vocal only when stored as exactly "vocal"', () => {
    localStorage.setItem(VOICE_MODE_KEY, 'vocal')
    expect(loadVoiceMode()).toBe('vocal')
    localStorage.setItem(VOICE_MODE_KEY, 'something-else')
    expect(loadVoiceMode()).toBe('text')
  })
})

describe('stripImages', () => {
  it('removes images from every message but keeps everything else intact', () => {
    const conversations = [
      {
        id: 'c1',
        title: 'Chat photo',
        updatedAt: 123,
        messages: [
          { role: 'user', content: "qu'est-ce que c'est ?", images: ['data:image/jpeg;base64,AAAA'] },
          { role: 'assistant', content: 'Un chat.' },
        ],
      },
      {
        id: 'c2',
        title: 'Autre conversation',
        updatedAt: 456,
        messages: [{ role: 'user', content: 'salut', images: ['data:image/jpeg;base64,BBBB'] }],
      },
    ]

    expect(stripImages(conversations)).toEqual([
      {
        id: 'c1',
        title: 'Chat photo',
        updatedAt: 123,
        messages: [
          { role: 'user', content: "qu'est-ce que c'est ?" },
          { role: 'assistant', content: 'Un chat.' },
        ],
      },
      {
        id: 'c2',
        title: 'Autre conversation',
        updatedAt: 456,
        messages: [{ role: 'user', content: 'salut' }],
      },
    ])
  })

  it('leaves messages without images untouched', () => {
    const conversations = [
      { id: 'c1', title: '', updatedAt: 1, messages: [{ role: 'user', content: 'salut' }] },
    ]
    expect(stripImages(conversations)).toEqual(conversations)
  })
})

describe('toOllamaMessage', () => {
  it('passes text-only messages through unchanged', () => {
    expect(toOllamaMessage({ role: 'user', content: 'salut' })).toEqual({
      role: 'user',
      content: 'salut',
    })
  })

  it('strips the data URL prefix from images, keeping bare base64', () => {
    const message = {
      role: 'user',
      content: "qu'est-ce que c'est ?",
      images: ['data:image/png;base64,AAAA', 'data:image/jpeg;base64,BBBB'],
    }
    expect(toOllamaMessage(message)).toEqual({
      role: 'user',
      content: "qu'est-ce que c'est ?",
      images: ['AAAA', 'BBBB'],
    })
  })

  it('treats an empty images array the same as no images', () => {
    expect(toOllamaMessage({ role: 'user', content: 'salut', images: [] })).toEqual({
      role: 'user',
      content: 'salut',
    })
  })
})

describe('resizeImageDataUrl', () => {
  const originalImage = global.Image
  const originalCreateElement = document.createElement.bind(document)

  afterEach(() => {
    global.Image = originalImage
    document.createElement = originalCreateElement
    vi.useRealTimers()
  })

  function stubImage({ width, height, mode = 'load' }) {
    class FakeImage {
      set src(value) {
        this._src = value
        queueMicrotask(() => {
          if (mode === 'error') this.onerror?.()
          else if (mode === 'hang') return
          else this.onload?.()
        })
      }
      get src() {
        return this._src
      }
    }
    FakeImage.prototype.width = width
    FakeImage.prototype.height = height
    global.Image = FakeImage
  }

  function stubCanvas({ ctxAvailable = true } = {}) {
    const ctx = { drawImage: vi.fn() }
    const toDataURL = vi.fn(() => 'data:image/jpeg;base64,RESIZED')
    let created = null
    document.createElement = (tag) => {
      if (tag === 'canvas') {
        created = { width: 0, height: 0, getContext: () => (ctxAvailable ? ctx : null), toDataURL }
        return created
      }
      return originalCreateElement(tag)
    }
    return { ctx, toDataURL, getCanvas: () => created }
  }

  it('returns the original data URL unchanged when already within the max dimension', async () => {
    stubImage({ width: 800, height: 600 })
    const result = await resizeImageDataUrl('data:image/png;base64,ORIGINAL', 1024)
    expect(result).toBe('data:image/png;base64,ORIGINAL')
  })

  it('downscales an oversized image, preserving aspect ratio, and re-encodes as JPEG', async () => {
    stubImage({ width: 4000, height: 2000 })
    const { ctx, toDataURL, getCanvas } = stubCanvas()
    const result = await resizeImageDataUrl('data:image/png;base64,BIG', 1024, 0.8)
    const canvas = getCanvas()
    expect(canvas.width).toBe(1024)
    expect(canvas.height).toBe(512)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 512)
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.8)
    expect(result).toBe('data:image/jpeg;base64,RESIZED')
  })

  it('falls back to the original data URL when a 2D context is unavailable', async () => {
    stubImage({ width: 4000, height: 2000 })
    stubCanvas({ ctxAvailable: false })
    const result = await resizeImageDataUrl('data:image/png;base64,BIG')
    expect(result).toBe('data:image/png;base64,BIG')
  })

  it('falls back to the original data URL if the image fails to decode', async () => {
    stubImage({ width: 0, height: 0, mode: 'error' })
    const result = await resizeImageDataUrl('data:image/png;base64,BROKEN')
    expect(result).toBe('data:image/png;base64,BROKEN')
  })

  it('falls back to the original data URL if decoding never completes', async () => {
    vi.useFakeTimers()
    stubImage({ width: 0, height: 0, mode: 'hang' })
    const promise = resizeImageDataUrl('data:image/png;base64,STUCK')
    await vi.advanceTimersByTimeAsync(2000)
    expect(await promise).toBe('data:image/png;base64,STUCK')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-27T12:00:00Z').getTime()

  it('reports "à l\'instant" for anything under 30 seconds', () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe("à l'instant")
  })

  it('reports minutes under an hour', () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('il y a 5 min')
  })

  it('reports hours under a day', () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('il y a 3 h')
  })

  it('reports "hier" for exactly one day ago', () => {
    expect(formatRelativeTime(now - 24 * 3_600_000, now)).toBe('hier')
  })

  it('reports days under a week', () => {
    expect(formatRelativeTime(now - 3 * 24 * 3_600_000, now)).toBe('il y a 3 j')
  })

  it('falls back to a date for a week or more', () => {
    const tenDaysAgo = now - 10 * 24 * 3_600_000
    expect(formatRelativeTime(tenDaysAgo, now)).toBe(
      new Date(tenDaysAgo).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
    )
  })

  it('defaults to the current time when now is not given', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 1000)).toBe("à l'instant")
    vi.useRealTimers()
  })
})
