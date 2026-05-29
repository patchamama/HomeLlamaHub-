import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { useAuthStore } from '../stores/auth'
import type { ChatMessage, ChatStreamChunk, ModelTag } from '../lib/types'
import { marked } from 'marked'
import hljs from 'highlight.js'
import Button from '../components/ui/Button'
import Spinner from '../components/ui/Spinner'

marked.setOptions({ gfm: true, breaks: true })

interface Message {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

function renderMarkdown(content: string): string {
  return marked.parse(content) as string
}

export default function ConsolePage() {
  const { accessToken } = useAuthStore()
  const [models, setModels] = useState<ModelTag[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api.listModels()
      .then((data) => {
        setModels(data)
        if (data.length > 0) setSelectedModel(data[0].name)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    // highlight code blocks after render
    document.querySelectorAll('pre code').forEach((el) => {
      hljs.highlightElement(el as HTMLElement)
    })
  }, [messages])

  async function handleSend() {
    if (!input.trim() || !selectedModel || streaming) return
    setError('')

    const userMsg: Message = { role: 'user', content: input.trim() }
    const history: ChatMessage[] = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMsg.content },
    ]
    setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '', streaming: true }])
    setInput('')
    setStreaming(true)

    try {
      const response = await api.chatCompletion(accessToken!, {
        model: selectedModel,
        messages: history,
        stream: true,
      })

      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (trimmed.startsWith('data: ')) {
            try {
              const chunk: ChatStreamChunk = JSON.parse(trimmed.slice(6))
              const delta = chunk.choices[0]?.delta?.content ?? ''
              if (delta) {
                setMessages((prev) => {
                  const next = [...prev]
                  const last = next[next.length - 1]
                  if (last.role === 'assistant') {
                    next[next.length - 1] = { ...last, content: last.content + delta }
                  }
                  return next
                })
              }
            } catch {
              // malformed chunk
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Streaming failed')
      setMessages((prev) => prev.slice(0, -1))
    } finally {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant') {
          next[next.length - 1] = { ...last, streaming: false }
        }
        return next
      })
      setStreaming(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function clearChat() {
    setMessages([])
    setError('')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#21262d] shrink-0">
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="hlh-input text-xs flex-1 max-w-xs"
        >
          {models.length === 0 && <option value="">No models available</option>}
          {models.map((m) => (
            <option key={m.name} value={m.name}>{m.name}</option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={clearChat} disabled={messages.length === 0}>
          Clear
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-12 h-12 rounded-xl bg-violet-900/30 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-400">Start a conversation</p>
            <p className="text-xs text-gray-600 mt-1">Select a model and type your message</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={['flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start'].join(' ')}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-lg bg-violet-900/40 border border-violet-700/30 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-violet-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" />
                </svg>
              </div>
            )}

            <div className={[
              'max-w-[75%] rounded-xl px-4 py-3 text-sm',
              msg.role === 'user'
                ? 'bg-violet-600/20 border border-violet-600/30 text-gray-100'
                : 'bg-[#161b22] border border-[#30363d]',
            ].join(' ')}>
              {msg.role === 'user' ? (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              ) : (
                msg.streaming && !msg.content ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <Spinner size="sm" />
                    <span className="text-xs">Thinking…</span>
                  </div>
                ) : (
                  <div
                    className="prose-hlh"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                  />
                )
              )}
            </div>

            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-lg bg-[#21262d] border border-[#30363d] flex items-center justify-center shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            )}
          </div>
        ))}

        {error && (
          <div className="text-xs text-red-400 text-center py-2">{error}</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-4 py-3 border-t border-[#21262d]">
        <div className="flex gap-2 items-end max-w-3xl mx-auto">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message… (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="hlh-input flex-1 resize-none min-h-[38px] max-h-32 overflow-y-auto leading-relaxed"
            style={{ height: 'auto' }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || !selectedModel || streaming}
            loading={streaming}
            size="sm"
            className="shrink-0"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
