import { describe, expect, it, vi } from 'vitest'
import { createElectronTransport } from '../src/renderer/ai/transport'

describe('Slides secure AI transport', () => {
  it('sends only conversation identity and model-turn content', () => {
    const start = vi.fn().mockResolvedValue(undefined)
    const cancel = vi.fn().mockResolvedValue(undefined)
    Object.assign(window, {
      slidesApi: {
        onAiStream: () => () => {},
        aiStream: start,
        aiStreamCancel: cancel,
      },
    })
    const identity = { projectId: 'project-1', chatId: 'chat-1' }
    const transport = createElectronTransport(() => identity)

    transport.stream(
      { system: 'system', messages: [{ role: 'user', text: 'hello' }], tools: [] },
      {
        onDelta: () => {},
        onToolCall: () => {},
        onDone: () => {},
        onError: () => {},
      },
    )

    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0]).toMatchObject({
      conversation: identity,
      system: 'system',
      messages: [{ role: 'user', text: 'hello' }],
      tools: [],
    })
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty('settings')
  })
})
