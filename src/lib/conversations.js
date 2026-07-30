export const LEGACY_MESSAGES_KEY = 'ollama-chat-messages'
export const CONVERSATIONS_KEY = 'ollama-chat-conversations'
export const PROFILE_NAME_KEY = 'ollama-chat-profile-name'
export const THEME_KEY = 'ollama-chat-theme'
export const SERVER_SYNC_KEY = 'ollama-chat-server-sync'
export const VOICE_MODE_KEY = 'ollama-chat-voice-mode'
export const AUTO_READ_REPLIES_KEY = 'ollama-chat-auto-read-replies'
export const DEFAULT_PROFILE_NAME = 'Vous'

// There is no model picker in the UI (single "Chat" mode): route to the
// vision model whenever the request carries images, the lighter text-only
// model otherwise.
export const TEXT_MODEL = 'llama3.1:8b-instruct-q4_0'
export const VISION_MODEL = 'qwen2.5vl:3b'

export function pickModel(messages) {
  return messages.some((m) => m.images && m.images.length > 0) ? VISION_MODEL : TEXT_MODEL
}

export function makeId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function deriveTitle(messages) {
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser) return ''
  const text = firstUser.content.trim().replace(/\s+/g, ' ')
  return text.length > 42 ? `${text.slice(0, 42)}…` : text
}

export function makeConversation() {
  return { id: makeId(), title: '', messages: [], updatedAt: Date.now() }
}

export function loadConversations() {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    // ignore corrupt storage
  }

  try {
    const legacyRaw = localStorage.getItem(LEGACY_MESSAGES_KEY)
    if (legacyRaw) {
      const legacyMessages = JSON.parse(legacyRaw)
      localStorage.removeItem(LEGACY_MESSAGES_KEY)
      if (Array.isArray(legacyMessages) && legacyMessages.length > 0) {
        return [
          {
            id: makeId(),
            title: deriveTitle(legacyMessages),
            messages: legacyMessages,
            updatedAt: Date.now(),
          },
        ]
      }
    }
  } catch {
    // ignore corrupt storage
  }

  return []
}

export function mostRecentId(conversations) {
  if (conversations.length === 0) return null
  return conversations.reduce((latest, c) => (c.updatedAt > latest.updatedAt ? c : latest), conversations[0]).id
}

export function loadProfileName() {
  try {
    return localStorage.getItem(PROFILE_NAME_KEY) || DEFAULT_PROFILE_NAME
  } catch {
    return DEFAULT_PROFILE_NAME
  }
}

export function loadTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function loadServerSync() {
  try {
    return localStorage.getItem(SERVER_SYNC_KEY) === 'true'
  } catch {
    return false
  }
}

export function loadVoiceMode() {
  try {
    return localStorage.getItem(VOICE_MODE_KEY) === 'vocal' ? 'vocal' : 'text'
  } catch {
    return 'text'
  }
}

// Defaults to on: unset (null) and 'true' both mean enabled, only an
// explicit 'false' turns it off.
export function loadAutoReadReplies() {
  try {
    return localStorage.getItem(AUTO_READ_REPLIES_KEY) !== 'false'
  } catch {
    return true
  }
}

// Full-resolution camera photos cause two separate problems: they can push
// the vision model's encoded token count past its fixed context window
// (see gitops-homelab ADR-0019), and storing them as-is means every
// conversations-state change re-serializes multi-MB base64 strings into
// localStorage synchronously, which can stall or crash the tab (no error
// boundary in this app). Downscale before ever storing/sending. Falls back
// to the original data URL — rather than blocking the attachment — if
// decoding fails or takes too long (e.g. no real image decoder available,
// as in this repo's jsdom test environment).
export const MAX_IMAGE_DIMENSION = 1024
export const IMAGE_JPEG_QUALITY = 0.8
const RESIZE_TIMEOUT_MS = 1500

export function resizeImageDataUrl(
  dataUrl,
  maxDimension = MAX_IMAGE_DIMENSION,
  quality = IMAGE_JPEG_QUALITY,
) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const timeoutId = setTimeout(() => finish(dataUrl), RESIZE_TIMEOUT_MS)

    const img = new Image()
    img.onload = () => {
      clearTimeout(timeoutId)
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height))
      if (scale === 1) {
        finish(dataUrl)
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        finish(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      finish(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => {
      clearTimeout(timeoutId)
      finish(dataUrl)
    }
    img.src = dataUrl
  })
}

// Ollama expects `images` as bare base64 strings, but the app stores full
// data URLs (so they can be rendered directly in <img src>) — strip the
// `data:image/...;base64,` prefix only when building the wire payload.
export function toOllamaMessage(message) {
  if (!message.images || message.images.length === 0) {
    return { role: message.role, content: message.content }
  }
  return {
    role: message.role,
    content: message.content,
    images: message.images.map((dataUrl) => dataUrl.split(',').pop()),
  }
}

export function formatRelativeTime(ts, now = Date.now()) {
  const min = Math.round((now - ts) / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const hr = Math.round(min / 60)
  if (hr < 24) return `il y a ${hr} h`
  const day = Math.round(hr / 24)
  if (day === 1) return 'hier'
  if (day < 7) return `il y a ${day} j`
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}
