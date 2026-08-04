import { describe, expect, it, vi } from 'vitest'
import { AI_CHANNELS } from '../src/shared/ipc'
import {
  parseAiChatRequest,
  parseAiStreamRequest,
  parseProjectAppendArgs,
  parseProjectLoadArgs,
  parseProjectRebindArgs,
  parseProjectResolveArgs,
  parseProjectSimpleArgs,
  registerAiRoutingIpc,
} from '../src/main/ai-routing-ipc'

describe('credential-safe AI request validation', () => {
  it('accepts content plus conversation identity', () => {
    expect(
      parseAiStreamRequest({
        requestId: 'request-1',
        conversation: { projectId: 'default', chatId: '0123456789abcdef' },
        system: 'system',
        messages: [{ role: 'user', text: 'hello' }],
        tools: [],
      }),
    ).toMatchObject({
      requestId: 'request-1',
      conversation: { projectId: 'default', chatId: '0123456789abcdef' },
    })
  })

  it('rejects legacy renderer-supplied provider settings', () => {
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-1',
        settings: { provider: 'openrouter', providers: { openrouter: { apiKey: 'secret' } } },
        system: 'system',
        messages: [],
      }),
    ).toThrow('unsupported field: settings')
    expect(() =>
      parseAiChatRequest({
        settings: { provider: 'openrouter' },
        system: 'system',
        user: 'hello',
      }),
    ).toThrow('unsupported field: settings')
  })

  it('rejects unsupported routes and malformed identities', () => {
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-1',
        conversation: { projectId: '', chatId: 'chat-1' },
        system: 'system',
        messages: [],
      }),
    ).toThrow('projectId is invalid')
  })

  it.each([
    { projectId: '../secrets', chatId: '0123456789abcdef' },
    { projectId: 'proj-0123456789ab/../../x', chatId: '0123456789abcdef' },
    { projectId: 'default', chatId: '../ai-secrets' },
    { projectId: 'default', chatId: 'unsaved-../../escape' },
    { projectId: '/tmp', chatId: '0123456789abcdef' },
  ])('rejects path-traversal identity $projectId / $chatId', (conversation) => {
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-1',
        conversation,
        system: 'system',
        messages: [],
      }),
    ).toThrow(/(?:projectId|chatId) is invalid/)
  })

  it('accepts bounded raw base64 images with supported MIME types', () => {
    const request = parseAiStreamRequest({
      requestId: 'request-image',
      system: 'system',
      messages: [
        {
          role: 'user',
          text: 'describe this',
          images: [{ mime: 'image/png', base64: Buffer.from('png').toString('base64') }],
        },
      ],
    })

    expect(request.messages[0]).toMatchObject({
      role: 'user',
      images: [{ mime: 'image/png', base64: 'cG5n' }],
    })
  })

  it.each([
    [{ mime: 'image/svg+xml', base64: 'PHN2Zz4=' }, 'MIME type is not supported'],
    [{ mime: 'image/png', base64: 'not base64!' }, 'base64 is invalid'],
    [{ mime: 'image/png', base64: '' }, 'base64 is invalid'],
  ])('rejects a hostile image payload %#', (image, expected) => {
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image',
        system: 'system',
        messages: [{ role: 'user', text: '', images: [image] }],
      }),
    ).toThrow(expected)
  })

  it('rejects images on non-user messages and oversized image collections', () => {
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image',
        system: 'system',
        messages: [{ role: 'assistant', text: '', images: [] }],
      }),
    ).toThrow('unsupported field: images')

    const image = { mime: 'image/png', base64: Buffer.from('x').toString('base64') }
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image',
        system: 'system',
        messages: [{ role: 'user', text: '', images: Array.from({ length: 11 }, () => image) }],
      }),
    ).toThrow('AI images are invalid')

    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image',
        system: 'system',
        messages: Array.from({ length: 3 }, () => ({
          role: 'user',
          text: '',
          images: Array.from({ length: 8 }, () => image),
        })),
      }),
    ).toThrow('AI images exceed the count limit')
  })

  it('enforces per-image and aggregate decoded-byte limits', () => {
    const tooLarge = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image-size',
        system: 'system',
        messages: [{ role: 'user', text: '', images: [{ mime: 'image/png', base64: tooLarge }] }],
      }),
    ).toThrow('AI image exceeds the size limit')

    const fourMegabytes = Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')
    expect(() =>
      parseAiStreamRequest({
        requestId: 'request-image-total-size',
        system: 'system',
        messages: [
          {
            role: 'user',
            text: '',
            images: Array.from({ length: 5 }, () => ({
              mime: 'image/jpeg',
              base64: fourMegabytes,
            })),
          },
        ],
      }),
    ).toThrow('AI images exceed the aggregate size limit')
  })

  it('requires image capability at the trusted send boundary', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const assertRouteAvailable = vi.fn(async () => {
      throw new Error('text-model does not support image input; choose a vision-capable model')
    })
    const send = vi.fn()
    registerAiRoutingIpc({
      ipcMain: {
        handle: (channel, listener) =>
          handlers.set(channel, listener as (...args: unknown[]) => unknown),
      },
      settings: {
        getGlobalDefault: () => ({ providerId: 'openrouter', modelId: 'text-model' }),
        assertRouteAvailable,
      } as never,
      getProjectStore: () => ({}) as never,
      getGensparkApiKey: () => '',
    })

    await handlers.get(AI_CHANNELS.stream)!(
      { sender: { id: 77, isDestroyed: () => false, send } },
      {
        requestId: 'image-boundary-request',
        system: 'system',
        messages: [
          {
            role: 'user',
            text: 'look',
            images: [{ mime: 'image/jpeg', base64: Buffer.from('jpeg').toString('base64') }],
          },
        ],
      },
    )

    expect(assertRouteAvailable).toHaveBeenCalledWith(
      { providerId: 'openrouter', modelId: 'text-model' },
      { requireImageInput: true },
    )
    expect(send).toHaveBeenCalledWith(
      AI_CHANNELS.streamChunk,
      expect.objectContaining({
        type: 'error',
        error: expect.stringContaining('does not support image input'),
      }),
    )
  })

  it('returns a persisted unavailable route for provenance without send-time validation', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const assertRouteAvailable = vi.fn(async () => {
      throw new Error('key removed')
    })
    registerAiRoutingIpc({
      ipcMain: {
        handle: (channel, listener) => {
          handlers.set(channel, listener as (...args: unknown[]) => unknown)
        },
      },
      settings: {
        getGlobalDefault: () => ({ providerId: 'genspark', modelId: 'claude-opus-4-7' }),
        assertRouteAvailable,
      } as never,
      getProjectStore: () =>
        ({
          getOrCreateChatAiMetadata: () => ({
            schemaVersion: 1,
            route: { providerId: 'openrouter', modelId: 'anthropic/claude-test' },
            createdAt: '2026-08-03T00:00:00.000Z',
            updatedAt: '2026-08-03T00:00:00.000Z',
          }),
          setChatAiRoute: vi.fn(),
        }) as never,
      getGensparkApiKey: () => '',
    })

    const handler = handlers.get(AI_CHANNELS.getConversationRoute)!
    const route = await handler(
      { sender: { id: 1, isDestroyed: () => false, send: vi.fn() } },
      { projectId: 'default', chatId: '0123456789abcdef' },
    )

    expect(route).toEqual({ providerId: 'openrouter', modelId: 'anthropic/claude-test' })
    expect(assertRouteAvailable).not.toHaveBeenCalled()
  })
})

describe('project IPC trusted-boundary validation', () => {
  it('accepts valid project requests and normalizes bounded values', () => {
    expect(
      parseProjectResolveArgs({
        filePath: null,
        tempChatId: 'unsaved-123',
        sessionId: 'session-1',
      }),
    ).toEqual({ filePath: null, tempChatId: 'unsaved-123', sessionId: 'session-1' })
    expect(parseProjectLoadArgs({ projectId: 'default', chatId: '0123456789abcdef' })).toEqual({
      projectId: 'default',
      chatId: '0123456789abcdef',
      limit: 200,
    })
    expect(parseProjectSimpleArgs('create', { name: '  Research  ' })).toEqual({
      name: 'Research',
    })
  })

  it.each([
    () => parseProjectResolveArgs({ filePath: '../outside.docx' }),
    () => parseProjectResolveArgs({ filePath: '/tmp/../outside.docx' }),
    () => parseProjectResolveArgs({ filePath: null, tempChatId: '../secrets' }),
    () =>
      parseProjectLoadArgs({
        projectId: 'proj-0123456789ab/../../outside',
        chatId: '0123456789abcdef',
      }),
    () =>
      parseProjectRebindArgs({
        projectId: 'default',
        tempChatId: 'unsaved-1',
        newChatId: '0123456789abcdef',
        newFilePath: '/tmp/file.docx',
      }),
    () =>
      parseProjectSimpleArgs('moveFile', { filePath: '/tmp/../etc/passwd', projectId: 'default' }),
    () => parseProjectSimpleArgs('timeline', { projectId: 'default', limit: 50_000 }),
    () => parseProjectSimpleArgs('delete', { id: 'default', extra: true }),
  ])('rejects hostile project payload %# before it reaches project-store', (parse) => {
    expect(parse).toThrow()
  })

  it('rejects malformed or secret-bearing provenance', () => {
    expect(() =>
      parseProjectAppendArgs({
        projectId: 'default',
        chatId: '0123456789abcdef',
        role: 'assistant',
        text: 'done',
        ai: {
          requested: {
            providerId: 'openrouter',
            modelId: 'openai/gpt-test',
            apiKey: 'must-not-cross-ipc',
          },
        },
      }),
    ).toThrow('unsupported field: apiKey')

    expect(() =>
      parseProjectAppendArgs({
        projectId: 'default',
        chatId: '0123456789abcdef',
        role: 'user',
        text: 'hello',
        ai: { requested: { providerId: 'openrouter', modelId: 'model' } },
      }),
    ).toThrow('AI provenance is invalid')
  })

  it('rejects malformed tools and attachment metadata', () => {
    expect(() =>
      parseProjectAppendArgs({
        projectId: 'default',
        chatId: '0123456789abcdef',
        role: 'assistant',
        text: 'done',
        tools: [{ name: 'tool', summary: 'ok', isError: 'yes' }],
      }),
    ).toThrow('isError must be a boolean')
    expect(() =>
      parseProjectAppendArgs({
        projectId: 'default',
        chatId: '0123456789abcdef',
        role: 'user',
        text: 'hello',
        attachments: [{ name: 'secret', path: '../../etc/passwd' }],
      }),
    ).toThrow('Attachment path is invalid')
  })
})
