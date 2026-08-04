import type { AgentStreamRequest, AgentTransport, IpcStreamChunk } from '@genoffice/agent-core'
import type {
  AiConversationIdentity,
  SecureAiStreamRequest as PublicAiStreamRequest,
} from '../../shared/desktop-api'
import { t } from '../i18n/locale'

type PublicAiStreamBridge = {
  getAiPublicSettings?: () => Promise<unknown>
  aiStream(request: PublicAiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(listener: (chunk: IpcStreamChunk) => void): () => void
}

export function buildPublicStreamRequest(
  requestId: string,
  conversation: AiConversationIdentity,
  request: AgentStreamRequest,
): PublicAiStreamRequest {
  return {
    requestId,
    conversation,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
  }
}

/**
 * Renderer-safe transport for the shared main-process AI router.
 *
 * The current contract sends only the conversation identity; main resolves the
 * sticky provider/model route and decrypts credentials. The extra arguments are
 * retained temporarily for call-site compatibility; secure routing is mandatory.
 */
export function createElectronTransport(
  getConversation: () => AiConversationIdentity | null,
  _getLegacySettings?: () => unknown,
  _usePublicRouting?: () => boolean,
): AgentTransport {
  const bridge = window.desktopApi as unknown as PublicAiStreamBridge

  return {
    stream(request, callbacks) {
      const requestId = crypto.randomUUID()
      const conversation = getConversation()
      if (!conversation) {
        queueMicrotask(() => callbacks.onError(t('aiUnknownError')))
        return { cancel: () => undefined }
      }

      const unsubscribe = bridge.onAiStream((chunk) => {
        if (chunk.requestId !== requestId) return
        if (chunk.type === 'delta') {
          callbacks.onDelta(chunk.text ?? '')
        } else if (chunk.type === 'tool-call') {
          if (chunk.toolCall) callbacks.onToolCall(chunk.toolCall)
        } else if (chunk.type === 'done') {
          unsubscribe()
          callbacks.onDone()
        } else {
          unsubscribe()
          callbacks.onError(chunk.error ?? t('aiUnknownError'))
        }
      })

      const wireRequest = buildPublicStreamRequest(requestId, conversation, request)
      void bridge.aiStream(wireRequest).catch((error: unknown) => {
        unsubscribe()
        callbacks.onError(error instanceof Error ? error.message : t('aiUnknownError'))
      })

      return {
        cancel: () => {
          unsubscribe()
          void bridge.aiStreamCancel(requestId)
        },
      }
    },
  }
}
