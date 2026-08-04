import { describe, expect, it, vi } from 'vitest'
import type { AiStreamChunk, DesktopApi } from '../src/shared/ipc'
import { createElectronTransport } from '../src/renderer/ai/transport'

describe('Docs AI transport', () => {
  it('sends only the conversation identity and prompt payload to main', () => {
    let listener: ((chunk: AiStreamChunk) => void) | undefined
    const aiStream = vi.fn()
    const unsubscribe = vi.fn()
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      value: {
        aiStream,
        aiStreamCancel: vi.fn(),
        onAiStream: (next: (chunk: AiStreamChunk) => void) => {
          listener = next
          return unsubscribe
        },
      } satisfies Partial<DesktopApi>,
    })

    const transport = createElectronTransport(() => ({ projectId: 'project-1', chatId: 'chat-1' }))
    const onDone = vi.fn()
    transport.stream(
      {
        system: 'You edit documents.',
        messages: [{ role: 'user', text: 'Draft an outline.' }],
        tools: [],
      },
      { onDelta: vi.fn(), onToolCall: vi.fn(), onDone, onError: vi.fn() },
    )

    expect(aiStream).toHaveBeenCalledTimes(1)
    const request = aiStream.mock.calls[0]![0] as Record<string, unknown>
    expect(request).toMatchObject({
      conversation: { projectId: 'project-1', chatId: 'chat-1' },
      system: 'You edit documents.',
    })
    expect(request).not.toHaveProperty('settings')
    expect(request).not.toHaveProperty('route')

    listener?.({ requestId: request.requestId as string, type: 'done' })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
