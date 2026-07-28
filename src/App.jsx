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
  loadTheme,
  loadVoiceMode,
  makeConversation,
  makeId,
  mostRecentId,
  pickModel,
  PROFILE_NAME_KEY,
  SERVER_SYNC_KEY,
  THEME_KEY,
  toOllamaMessage,
  VOICE_MODE_KEY,
} from './lib/conversations'
import './App.css'

function App() {
  const [conversations, setConversations] = useState(loadConversations)
  const [activeId, setActiveId] = useState(() => mostRecentId(loadConversations()))
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [editingIndex, setEditingIndex] = useState(null)
  const [editingText, setEditingText] = useState('')
  const [profileName, setProfileName] = useState(loadProfileName)
  const [theme, setTheme] = useState(loadTheme)
  const [serverSync, setServerSync] = useState(loadServerSync)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [voiceMode, setVoiceMode] = useState(loadVoiceMode)
  const [isListening, setIsListening] = useState(false)
  const listEndRef = useRef(null)
  const profileSectionRef = useRef(null)
  const syncedOnceRef = useRef(false)
  const fileInputRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const audioPlayerRef = useRef(null)
  const wasStreamingRef = useRef(false)

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0] ?? null,
    [conversations, activeId],
  )
  const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation])

  // No model picker: this just confirms Ollama is reachable at startup.
  useEffect(() => {
    fetch('/api/tags')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to reach Ollama: ${res.status}`)
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
    localStorage.setItem(VOICE_MODE_KEY, voiceMode)
  }, [voiceMode])

  // Leaving vocal mode mid-dictation or mid-playback should stop both rather
  // than let them run on invisibly in the background.
  useEffect(() => {
    if (voiceMode === 'vocal') return
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
    audioPlayerRef.current?.pause()
    setIsListening(false)
  }, [voiceMode])

  // Speak the assistant's reply (via the Piper TTS proxy) once streaming
  // finishes, but only for a reply that just streamed in this session — not
  // on mount/history load.
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && voiceMode === 'vocal') {
      const last = messages[messages.length - 1]
      if (last?.role === 'assistant' && last.content) {
        fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: last.content }),
        })
          .then((res) => {
            if (!res.ok) throw new Error(`TTS a répondu ${res.status}`)
            return res.blob()
          })
          .then((blob) => {
            const audio = audioPlayerRef.current
            if (!audio) return
            const url = URL.createObjectURL(blob)
            audio.src = url
            audio.onended = () => URL.revokeObjectURL(url)
            audio.play()
          })
          .catch((err) => setError(`Erreur de synthèse vocale : ${err.message}`))
      }
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming, voiceMode, messages])

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
      const conv = makeConversation()
      setConversations([conv])
      setActiveId(conv.id)
    } else if (!activeId || !conversations.some((c) => c.id === activeId)) {
      setActiveId(mostRecentId(conversations))
    }
  }, [conversations, activeId])

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
    const conv = makeConversation()
    setConversations((prev) => [conv, ...prev])
    setActiveId(conv.id)
    setHistoryOpen(false)
  }

  function handleSelectConversation(id) {
    setActiveId(id)
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

  // Sends `messagesForModel` to Ollama and streams the reply into the
  // conversation's last message, which must already be the empty assistant
  // placeholder. Shared by handleSend and edit-triggered regeneration so
  // both paths stream and error-handle identically.
  async function streamReply(convId, messagesForModel) {
    setError('')
    setIsStreaming(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: pickModel(messagesForModel),
          messages: messagesForModel.map(toOllamaMessage),
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

  function handleAttachFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    for (const file of files) {
      const reader = new FileReader()
      reader.onload = () => {
        setAttachments((prev) => [...prev, { id: makeId(), dataUrl: reader.result }])
      }
      reader.readAsDataURL(file)
    }
  }

  function handleRemoveAttachment(id) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  async function handleMicClick() {
    if (isListening) {
      mediaRecorderRef.current?.stop()
      return
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError("Le microphone n'est pas accessible.")
      return
    }

    const recorder = new MediaRecorder(stream)
    audioChunksRef.current = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop())
      setIsListening(false)
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
      const formData = new FormData()
      formData.append('audio_file', audioBlob, 'recording.webm')
      try {
        const res = await fetch('/api/stt?task=transcribe&language=fr&output=json', {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) throw new Error(`STT a répondu ${res.status}`)
        const data = await res.json()
        const transcript = data.text?.trim()
        if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript))
      } catch (err) {
        setError(`Erreur de dictée : ${err.message}`)
      }
    }

    mediaRecorderRef.current = recorder
    recorder.start()
    setIsListening(true)
  }

  async function handleSend(e) {
    e.preventDefault()
    const userText = input.trim()
    if ((!userText && attachments.length === 0) || isStreaming || !activeConversation) return

    const convId = activeConversation.id
    const images = attachments.map((a) => a.dataUrl)
    const userMessage = { role: 'user', content: userText, ...(images.length > 0 ? { images } : {}) }
    const newMessages = [...messages, userMessage]
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c
        const msgs = [...newMessages, { role: 'assistant', content: '' }]
        return { ...c, messages: msgs, title: c.title || deriveTitle(msgs), updatedAt: Date.now() }
      }),
    )
    setInput('')
    setAttachments([])
    await streamReply(convId, newMessages)
  }

  function handleEditStart(i) {
    if (isStreaming) return
    setEditingIndex(i)
    setEditingText(messages[i].content)
  }

  function handleEditCancel() {
    setEditingIndex(null)
    setEditingText('')
  }

  // Edits the message at index i and discards everything after it, since
  // later messages were replies to content that no longer exists. Editing a
  // user message also re-asks the model, replacing the old assistant reply;
  // editing an assistant message just rewrites history in place.
  async function handleEditSave(i) {
    const text = editingText.trim()
    if (!text || !activeConversation) return

    const convId = activeConversation.id
    const editedRole = messages[i].role
    const truncated = [...messages.slice(0, i), { ...messages[i], content: text }]
    setEditingIndex(null)
    setEditingText('')

    if (editedRole === 'user') {
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c
          const msgs = [...truncated, { role: 'assistant', content: '' }]
          return { ...c, messages: msgs, updatedAt: Date.now() }
        }),
      )
      await streamReply(convId, truncated)
    } else {
      setConversationMessages(convId, () => truncated)
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
            className="mode-select"
            aria-label="Mode"
            value={voiceMode}
            onChange={(e) => setVoiceMode(e.target.value)}
          >
            <option value="text">Chat</option>
            <option value="vocal">Vocal</option>
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
          const isEditing = editingIndex === i
          return (
            <div key={i} className={`message ${msg.role} ${isEditing ? 'editing' : ''}`}>
              <div className="message-head">
                <span className="role-label">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
                {!isEditing && !isPending && (
                  <button
                    type="button"
                    className="message-edit-btn"
                    onClick={() => handleEditStart(i)}
                    disabled={isStreaming}
                    aria-label="Modifier le message"
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9"></path>
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
                    </svg>
                  </button>
                )}
              </div>
              {msg.images && msg.images.length > 0 && (
                <div className="message-images">
                  {msg.images.map((src, imgIdx) => (
                    <img key={imgIdx} src={src} alt="" className="message-image" />
                  ))}
                </div>
              )}
              {isEditing ? (
                <div className="message-edit">
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleEditSave(i)
                      } else if (e.key === 'Escape') {
                        handleEditCancel()
                      }
                    }}
                    autoFocus
                    rows={Math.min(10, Math.max(2, editingText.split('\n').length))}
                  />
                  <div className="message-edit-actions">
                    <button type="button" onClick={handleEditCancel}>
                      Annuler
                    </button>
                    <button type="button" className="primary" onClick={() => handleEditSave(i)} disabled={!editingText.trim()}>
                      Enregistrer{msg.role === 'user' ? ' et régénérer' : ''}
                    </button>
                  </div>
                </div>
              ) : isPending ? (
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
        {attachments.length > 0 && (
          <div className="attachment-strip">
            {attachments.map((a) => (
              <div className="attachment-thumb" key={a.id}>
                <img src={a.dataUrl} alt="" />
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() => handleRemoveAttachment(a.id)}
                  aria-label="Retirer l'image"
                >
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="5" x2="19" y2="19"></line>
                    <line x1="19" y1="5" x2="5" y2="19"></line>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="input-row">
          <button
            type="button"
            className="icon-btn attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            aria-label="Joindre une image"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
            </svg>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={handleAttachFiles}
          />
          {voiceMode === 'vocal' && (
            <button
              type="button"
              className={`icon-btn mic-btn ${isListening ? 'listening' : ''}`}
              onClick={handleMicClick}
              disabled={isStreaming}
              aria-label={isListening ? 'Arrêter la dictée' : 'Dicter un message'}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="2" width="6" height="12" rx="3"></rect>
                <path d="M5 10a7 7 0 0 0 14 0"></path>
                <line x1="12" y1="19" x2="12" y2="22"></line>
              </svg>
            </button>
          )}
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
              disabled={isStreaming || (!input.trim() && attachments.length === 0)}
              aria-label="Send"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </div>
        </div>
      </form>
      <audio ref={audioPlayerRef} hidden />
    </div>
  )
}

export default App
