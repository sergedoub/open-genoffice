import type { AgentStreamRequest, AgentTransport } from '@genoffice/agent-core'
import type { AiConversationIdentity } from '../../shared/ipc'
import { t } from '../i18n/locale'

/**
 * Renderer-safe IPC transport. Provider configuration and credentials stay in
 * Electron main; the renderer sends only the document conversation identity.
 */
export function createElectronTransport(
  getConversation: () => AiConversationIdentity | undefined,
): AgentTransport {
  return {
    stream(request: AgentStreamRequest, callbacks) {
      const requestId = crypto.randomUUID()
      const unsubscribe = window.desktop.onAiStream((chunk) => {
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

      void window.desktop.aiStream({
        requestId,
        conversation: getConversation(),
        system: request.system,
        messages: request.messages,
        tools: request.tools,
      })

      return {
        cancel: () => {
          void window.desktop.aiStreamCancel(requestId)
        },
      }
    },
  }
}
