import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  CONVERSATIONS_KEY,
  deriveTitle,
  formatRelativeTime,
  loadConversations,
  loadProfileName,
  loadServerSync,
  loadStoredModel,
  loadTheme,
  makeConversation,
  MODEL_STORAGE_KEY,
  mostRecentId,
  PROFILE_NAME_KEY,
  SERVER_SYNC_KEY,
  THEME_KEY,
} from './lib/conversations'
import './App.css'

function App() {
  const [models, setModels] = useState([])
  const [selectedModel, setSelectedModel] = useState(loadStoredModel)
  const [conversations, setConversations] = useState(loadConversations)
  const [activeId, setActiveId] = useState(() => mostRecentId(loadConversations()))
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [profileName, setProfileName] = useState(loadProfileName)
  const [theme, setTheme] = useState(loadTheme)
  const [serverSync, setServerSync] = useState(loadServerSync)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const listEndRef = useRef(null)
  const profileSectionRef = useRef(null)
  const syncedOnceRef = useRef(false)

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0] ?? null,
    [conversations, activeId],
  )
  const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation])

  useEffect(() => {
    fetch('/api/tags')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to list models: ${res.status}`)
        return res.json()
      })
      .then((data) => {
        const names = (data.models || []).map((m) => m.name)
        setModels(names)
        setSelectedModel((prev) => {
          if (prev && names.includes(prev)) return prev
          const llama = names.find((n) => n.toLowerCase().includes('llama'))
          return llama || names[0] || ''
        })
      })
      .catch((err) => setError(`Could not reach Ollama: ${err.message}`))
  }, [])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations))
  }, [conversations])

  useEffect(() => {
    if (selectedModel) localStorage.setItem(MODEL_STORAGE_KEY, selectedModel)
  }, [selectedModel])

  useEffect(() => {
    localStorage.setItem(PROFILE_NAME_KEY, profileName)
  }, [profileName])

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme)
    if (theme === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    localStorage.setItem(SERVER_SYNC_KEY, String(serverSync))
  }, [serverSync])

  useEffect(() => {
    if (!historyOpen) setProfileMenuOpen(false)
  }, [historyOpen])

  useEffect(() => {
    if (!profileMenuOpen) return
    function handleClickOutside(e) {
      if (profileSectionRef.current && !profileSectionRef.current.contains(e.target)) {
        setProfileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [profileMenuOpen])

  // Hydrate once each time server sync is turned on: adopt server state if it
  // has data, otherwise leave local state as-is (the push effect below will
  // seed the server with it).
  useEffect(() => {
    if (!serverSync) {
      syncedOnceRef.current = false
      return
    }
    if (syncedOnceRef.current) return
    syncedOnceRef.current = true
    fetch('/session')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.conversations) && data.conversations.length > 0) {
          setConversations(data.conversations)
          if (data.profileName) setProfileName(data.profileName)
          if (data.theme) setTheme(data.theme)
        }
      })
      .catch((err) => setError(`Sync serveur impossible : ${err.message}`))
  }, [serverSync])

  useEffect(() => {
    if (!serverSync) return
    const timer = setTimeout(() => {
      fetch('/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversations, profileName, theme }),
      }).catch((err) => setError(`Sync serveur impossible : ${err.message}`))
    }, 1200)
    return () => clearTimeout(timer)
  }, [serverSync, conversations, profileName, theme])

  useEffect(() => {
    if (conversations.length === 0) {
      const conv = makeConversation(selectedModel)
      setConversations([conv])
      setActiveId(conv.id)
    } else if (!activeId || !conversations.some((c) => c.id === activeId)) {
      setActiveId(mostRecentId(conversations))
    }
  }, [conversations, activeId, selectedModel])

  function setConversationMessages(id, updater) {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c
        const nextMessages = typeof updater === 'function' ? updater(c.messages) : updater
        return {
          ...c,
          messages: nextMessages,
          title: c.title || deriveTitle(nextMessages),
          updatedAt: Date.now(),
        }
      }),
    )
  }

  function handleNewConversation() {
    if (isStreaming) return
    const conv = makeConversation(selectedModel)
    setConversations((prev) => [conv, ...prev])
    setActiveId(conv.id)
    setHistoryOpen(false)
  }

  function handleSelectConversation(id) {
    setActiveId(id)
    const conv = conversations.find((c) => c.id === id)
    if (conv?.model && models.includes(conv.model)) setSelectedModel(conv.model)
    setHistoryOpen(false)
  }

  function handleDeleteConversation(id, e) {
    e.stopPropagation()
    if (!window.confirm('Supprimer cette conversation ?')) return
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (id === activeId) setActiveId(null)
  }

  function handleClearAllConversations() {
    if (!window.confirm('Supprimer toutes les conversations ?')) return
    setConversations([])
    setActiveId(null)
    setProfileMenuOpen(false)
  }

  async function handleSend(e) {
    e.preventDefault()
    const userText = input.trim()
    if (!userText || isStreaming || !selectedModel || !activeConversation) return

    const convId = activeConversation.id
    setError('')
    const newMessages = [...messages, { role: 'user', content: userText }]
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c
        const msgs = [...newMessages, { role: 'assistant', content: '' }]
        return { ...c, messages: msgs, model: selectedModel, title: c.title || deriveTitle(msgs), updatedAt: Date.now() }
      }),
    )
    setInput('')
    setIsStreaming(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: newMessages,
          stream: true,
        }),
      })

      if (!res.ok) throw new Error(`Ollama returned ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.trim()) continue
          const parsed = JSON.parse(line)
          if (parsed.message?.content) {
            setConversationMessages(convId, (prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              updated[updated.length - 1] = {
                ...last,
                content: last.content + parsed.message.content,
              }
              return updated
            })
          }
        }
      }
    } catch (err) {
      setError(`Error: ${err.message}`)
    } finally {
      setIsStreaming(false)
    }
  }

  const sortedConversations = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="app">
      <div className="app-header">
        <div className="header-left">
          <button
            type="button"
            className="icon-btn"
            onClick={() => setHistoryOpen(true)}
            aria-label="Historique des conversations"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="7" x2="20" y2="7"></line>
              <line x1="4" y1="12" x2="20" y2="12"></line>
              <line x1="4" y1="17" x2="14" y2="17"></line>
            </svg>
          </button>
          <h1>Ollama Chat</h1>
        </div>
        <div className="header-actions">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            disabled={isStreaming || models.length === 0}
          >
            {models.length === 0 && <option>No models found</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="new-chat-btn"
            onClick={handleNewConversation}
            disabled={isStreaming || messages.length === 0}
            aria-label="New conversation"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {historyOpen && (
        <div className="history-overlay" onClick={() => setHistoryOpen(false)}>
          <div className="history-panel" onClick={(e) => e.stopPropagation()}>
            <div className="history-header">
              <span>Conversations</span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setHistoryOpen(false)}
                aria-label="Fermer l'historique"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="5" x2="19" y2="19"></line>
                  <line x1="19" y1="5" x2="5" y2="19"></line>
                </svg>
              </button>
            </div>
            <ul className="history-list">
              {sortedConversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`history-item ${c.id === activeId ? 'active' : ''}`}
                    onClick={() => handleSelectConversation(c.id)}
                  >
                    <span className="history-item-title">{c.title || 'Nouvelle conversation'}</span>
                    <span className="history-item-time">{formatRelativeTime(c.updatedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="history-delete"
                    onClick={(e) => handleDeleteConversation(c.id, e)}
                    aria-label="Supprimer la conversation"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 7 6 7 20 7"></polyline>
                      <path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path>
                      <path d="M18 7l-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7"></path>
                    </svg>
                  </button>
                </li>
              ))}
            </ul>

            <div className="profile-section" ref={profileSectionRef}>
              {profileMenuOpen && (
                <div className="profile-menu">
                  <label className="profile-menu-row">
                    <span>Nom</span>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                    />
                  </label>
                  <label className="profile-menu-row">
                    <span>Thème</span>
                    <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                      <option value="system">Système</option>
                      <option value="light">Clair</option>
                      <option value="dark">Sombre</option>
                    </select>
                  </label>
                  <label className="profile-menu-row profile-menu-toggle">
                    <span>Sauvegarder sur le serveur</span>
                    <input
                      type="checkbox"
                      checked={serverSync}
                      onChange={(e) => setServerSync(e.target.checked)}
                    />
                  </label>
                  <button
                    type="button"
                    className="profile-menu-danger"
                    onClick={handleClearAllConversations}
                  >
                    Effacer toutes les conversations
                  </button>
                  <div className="profile-menu-about">Ollama Chat · v0.0.0</div>
                </div>
              )}
              <button
                type="button"
                className="profile-btn"
                onClick={() => setProfileMenuOpen((o) => !o)}
                aria-label="Profil"
              >
                <span className="profile-avatar">
                  {(profileName.trim()[0] || '?').toUpperCase()}
                </span>
                <span className="profile-name">{profileName || 'Vous'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="message-list">
        {messages.map((msg, i) => {
          const isPending = isStreaming && i === messages.length - 1 && msg.content === ''
          return (
            <div key={i} className={`message ${msg.role}`}>
              <span className="role-label">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
              {isPending ? (
                <span className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              ) : (
                <div className="markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              )}
            </div>
          )
        })}
        <div ref={listEndRef} />
      </div>

      <form className="input-bar" onSubmit={handleSend}>
        <div className="input-wrap">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isStreaming}
            placeholder="Type a message..."
          />
          <button
            type="submit"
            className="send-btn"
            disabled={isStreaming || !input.trim() || !selectedModel}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"></line>
              <polyline points="5 12 12 5 19 12"></polyline>
            </svg>
          </button>
        </div>
      </form>
    </div>
  )
}

export default App
