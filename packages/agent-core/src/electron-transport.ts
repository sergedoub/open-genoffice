import type {
  AgentStreamRequest,
  AgentToolCall,
  AgentToolDef,
  AgentTransport,
  AgentMessage,
} from './types'

/**
 * One streamed chunk pushed back over an Electron IPC bridge. Structurally
 * identical to ai-provider's AiStreamChunk; declared here so this package
 * stays dependency-free.
 */
export interface IpcStreamChunk {
  requestId: string
  type: 'delta' | 'tool-call' | 'done' | 'error'
  text?: string
  toolCall?: AgentToolCall
  error?: string
}

/** The request forwarded to the main process to start one streaming turn. */
export interface IpcStreamStart<S> {
  requestId: string
  settings: S
  system: string
  messages: AgentMessage[]
  tools: AgentToolDef[]
}

export interface IpcTransportOptions<S> {
  /** subscribe to stream chunks; returns the unsubscribe function */
  onStream(listener: (chunk: IpcStreamChunk) => void): () => void
  /** forward the start request to the main process */
  start(request: IpcStreamStart<S>): void
  /** abort the in-flight turn in the main process */
  cancel(requestId: string): void
  getSettings(): S
  /** localized fallback when an error chunk carries no message */
  unknownErrorText(): string
}

/**
 * AgentTransport over an Electron IPC bridge: the main process talks to the
 * LLM providers (avoids renderer CORS) and streams chunks back per requestId.
 * Each app wires in its own preload bridge and i18n via the options.
 */
export function createIpcTransport<S>(options: IpcTransportOptions<S>): AgentTransport {
  return {
    stream(request: AgentStreamRequest, cb) {
      const requestId = crypto.randomUUID()
      const unsubscribe = options.onStream((chunk) => {
        if (chunk.requestId !== requestId) return
        if (chunk.type === 'delta') {
          cb.onDelta(chunk.text ?? '')
        } else if (chunk.type === 'tool-call') {
          if (chunk.toolCall) cb.onToolCall(chunk.toolCall)
        } else if (chunk.type === 'done') {
          unsubscribe()
          cb.onDone()
        } else {
          unsubscribe()
          cb.onError(chunk.error ?? options.unknownErrorText())
        }
      })
      options.start({
        requestId,
        settings: options.getSettings(),
        system: request.system,
        messages: request.messages,
        tools: request.tools,
      })
      return { cancel: () => options.cancel(requestId) }
    },
  }
}
