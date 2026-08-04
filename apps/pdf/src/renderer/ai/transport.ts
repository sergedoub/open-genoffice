import type { AgentStreamRequest, AgentTransport } from '@genoffice/agent-core'
import type { AiConversationIdentity } from '../../shared/ipc'
import { t } from '../i18n/locale'

/**
 * Renderer-safe IPC transport. The renderer supplies only the document
 * conversation identity; Electron main resolves the validated route and secret.
 */
export function createElectronTransport(
  getConversation: () => AiConversationIdentity | undefined,
): AgentTransport {
  return {
    stream(request: AgentStreamRequest, callbacks) {
      const requestId = crypto.randomUUID()
      let settled = false
      const finish = (callback: () => void): void => {
        if (settled) return
        settled = true
        unsubscribe()
        callback()
      }
      const unsubscribe = window.pdfApi.onAiStream((chunk) => {
        if (chunk.requestId !== requestId) return
        if (chunk.type === 'delta') callbacks.onDelta(chunk.text ?? '')
        else if (chunk.type === 'tool-call') {
          if (chunk.toolCall) callbacks.onToolCall(chunk.toolCall)
        } else if (chunk.type === 'done') finish(callbacks.onDone)
        else finish(() => callbacks.onError(chunk.error ?? t('aiUnknownError')))
      })

      void window.pdfApi
        .aiStream({
          requestId,
          conversation: getConversation(),
          system: request.system,
          messages: request.messages,
          tools: request.tools,
        })
        .catch((error: unknown) =>
          finish(() => callbacks.onError(error instanceof Error ? error.message : String(error))),
        )

      return {
        cancel: () => {
          void window.pdfApi.aiStreamCancel(requestId)
        },
      }
    },
  }
}
