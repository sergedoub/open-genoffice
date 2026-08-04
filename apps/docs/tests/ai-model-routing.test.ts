import { act, createElement } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import type { ProjectApi } from '@genoffice/project-store'
import type { AiModelSummary, AiRoute, AiStreamChunk, DesktopApi } from '../src/shared/ipc'
import { editorExtensions } from '../src/renderer/editor/extensions'
import {
  AiPanel,
  isDocsCompatibleModel,
  modelCompactionBudget,
  modelSupportsImages,
} from '../src/renderer/ai/AiPanel'

const textRoute: AiRoute = { providerId: 'openrouter', modelId: 'text-model' }
const visionRoute: AiRoute = { providerId: 'openrouter', modelId: 'vision-model' }
const limitedFreeRoute: AiRoute = {
  providerId: 'openrouter',
  modelId: 'google/gemma-test:free',
}
const freeRouterRoute: AiRoute = { providerId: 'openrouter', modelId: 'openrouter/free' }

function model(id: string, image: boolean, contextWindow = 128_000): AiModelSummary {
  return {
    id,
    canonicalId: `vendor/${id}`,
    providerId: 'openrouter',
    name: image ? 'Vision Model' : 'Text Model',
    expiresAt: null,
    available: true,
    capabilities: {
      inputModalities: image ? ['text', 'image'] : ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      contextWindow,
      maxOutputTokens: 8_192,
    },
  }
}

const allModels = [
  model('text-model', false),
  model('vision-model', true),
  { ...model(limitedFreeRoute.modelId, false), name: 'Google: Gemma Test (free)' },
  { ...model(freeRouterRoute.modelId, false), name: 'OpenRouter Free Router' },
]

function createEditor(): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        {
          type: 'docParagraph',
          attrs: { docxIndex: 0 },
          content: [{ type: 'text', text: 'Existing document' }],
        },
      ],
    },
  })
}

function mountPanel(editor: Editor): { container: HTMLElement; root: Root; cleanup: () => void } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(createElement(AiPanel, { editor, blocks: [], filePath: '/tmp/report.docx' }))
  })
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function installApis(options?: {
  route?: AiRoute
  historyHasImage?: boolean
  routeWriteError?: Error
  loggedIn?: boolean
  streamError?: string
}) {
  const route = options?.route ?? textRoute
  const getAiConversationRoute = vi.fn(async () => route)
  const setAiConversationRoute = vi.fn(async (_identity: unknown, next: AiRoute) => {
    if (options?.routeWriteError) throw options.routeWriteError
    return next
  })
  const listAiModels = vi.fn(async () => ({ models: allModels, catalogs: [] }))
  let streamHandler: ((chunk: AiStreamChunk) => void) | undefined
  const aiStream = vi.fn(async (request: { requestId: string }) => {
    if (options?.streamError) {
      queueMicrotask(() =>
        streamHandler?.({
          requestId: request.requestId,
          type: 'error',
          error: options.streamError,
        }),
      )
    }
  })
  const aiGskStatus = vi.fn(async () => ({ loggedIn: options?.loggedIn ?? true }))

  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: {
      getAiPublicSettings: async () => ({
        schemaVersion: 1 as const,
        globalDefault: textRoute,
        providers: [
          {
            id: 'openrouter' as const,
            label: 'OpenRouter',
            status: 'connected' as const,
            hasApiKey: true,
          },
        ],
        secureStorageAvailable: true,
      }),
      listAiModels,
      getAiConversationRoute,
      setAiConversationRoute,
      onAiStream: (handler) => {
        streamHandler = handler
        return () => {
          if (streamHandler === handler) streamHandler = undefined
        }
      },
      aiStream,
      aiStreamCancel: async () => {},
      aiGskStatus,
      pickAttachments: async () => null,
    } satisfies Partial<DesktopApi>,
  })

  Object.defineProperty(window, 'projectApi', {
    configurable: true,
    value: {
      resolveChat: async () => ({ projectId: 'default', chatId: '0123456789abcdef' }),
      loadChat: async () => [
        {
          seq: 1,
          ts: '2026-08-03T00:00:00.000Z',
          role: 'user' as const,
          text: 'Keep this prior turn',
          ...(options?.historyHasImage
            ? { attachments: [{ name: 'chart.png', ext: 'png', path: '/tmp/chart.png' }] }
            : {}),
        },
      ],
      appendChat: async () => {},
      rebindChat: async () => ({ projectId: 'default', chatId: '0123456789abcdef' }),
    } satisfies Partial<ProjectApi>,
  })

  return { getAiConversationRoute, setAiConversationRoute, listAiModels, aiStream, aiGskStatus }
}

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Docs model capability rules', () => {
  it('does not fabricate resolved model provenance', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/ai/AiPanel.tsx'), 'utf8')
    expect(source).not.toContain('resolved: route')
  })

  it('filters text-only models once the conversation contains images', () => {
    expect(isDocsCompatibleModel(allModels[0]!, false)).toBe(true)
    expect(isDocsCompatibleModel(allModels[0]!, true)).toBe(false)
    expect(isDocsCompatibleModel(allModels[1]!, true)).toBe(true)
    expect(modelSupportsImages(allModels[1])).toBe(true)
  })

  it('derives a bounded incoming context budget for pre-switch compaction', () => {
    expect(modelCompactionBudget(model('small', false, 32_000))).toEqual({
      maxBytes: 76_800,
      keepRecentBytes: 28_800,
    })
  })
})

describe('Docs per-document model route', () => {
  it('loads and changes the route through main, then retains history', async () => {
    const apis = installApis()
    const editor = createEditor()
    const mounted = mountPanel(editor)
    await flushEffects()

    expect(apis.getAiConversationRoute).toHaveBeenCalledWith({
      projectId: 'default',
      chatId: '0123456789abcdef',
    })
    expect(mounted.container.textContent).toContain('Keep this prior turn')

    const trigger = mounted.container.querySelector<HTMLButtonElement>('.model-picker__trigger')!
    expect(trigger.textContent).toContain('Text Model')
    act(() => trigger.click())
    const visionOption = Array.from(
      document.querySelectorAll<HTMLElement>('.model-picker__option'),
    ).find((option) => option.textContent?.includes('Vision Model'))!
    act(() => visionOption.click())
    await flushEffects()

    expect(apis.setAiConversationRoute).toHaveBeenCalledWith(
      { projectId: 'default', chatId: '0123456789abcdef' },
      visionRoute,
    )
    expect(trigger.textContent).toContain('Vision Model')
    expect(mounted.container.textContent).toContain('Keep this prior turn')
    expect(mounted.container.textContent).toContain('Switched to Vision Model')

    mounted.cleanup()
    editor.destroy()
  })

  it('excludes text-only choices when restored history contains an image', async () => {
    const apis = installApis({ route: visionRoute, historyHasImage: true })
    const editor = createEditor()
    const mounted = mountPanel(editor)
    await flushEffects()
    await flushEffects()

    expect(apis.listAiModels).toHaveBeenCalledWith({ requireImageInput: true })
    const trigger = mounted.container.querySelector<HTMLButtonElement>('.model-picker__trigger')!
    act(() => trigger.click())
    const labels = Array.from(
      document.querySelectorAll<HTMLElement>('.model-picker__option-label'),
      (option) => option.textContent,
    )
    expect(labels).toContain('Vision Model')
    expect(labels).not.toContain('Text Model')

    mounted.cleanup()
    editor.destroy()
  })

  it('keeps the old route and conversation UI when route persistence fails', async () => {
    const apis = installApis({ routeWriteError: new Error('Route write failed') })
    const editor = createEditor()
    const mounted = mountPanel(editor)
    await flushEffects()

    const trigger = mounted.container.querySelector<HTMLButtonElement>('.model-picker__trigger')!
    act(() => trigger.click())
    const visionOption = Array.from(
      document.querySelectorAll<HTMLElement>('.model-picker__option'),
    ).find((option) => option.textContent?.includes('Vision Model'))!
    act(() => visionOption.click())
    await flushEffects()

    expect(apis.setAiConversationRoute).toHaveBeenCalledWith(
      { projectId: 'default', chatId: '0123456789abcdef' },
      visionRoute,
    )
    expect(trigger.textContent).toContain('Text Model')
    expect(mounted.container.textContent).toContain('Keep this prior turn')
    expect(mounted.container.textContent).not.toContain('Switched to Vision Model')
    expect(mounted.container.textContent).toContain('Route write failed')

    mounted.cleanup()
    editor.destroy()
  })

  it('shows a saved unavailable route and blocks sending until it is replaced', async () => {
    const unavailableRoute: AiRoute = { providerId: 'openrouter', modelId: 'removed-model' }
    const apis = installApis({ route: unavailableRoute })
    const editor = createEditor()
    const mounted = mountPanel(editor)
    await flushEffects()

    const trigger = mounted.container.querySelector<HTMLButtonElement>('.model-picker__trigger')!
    expect(trigger.textContent).toContain('removed-model (Unavailable)')
    expect(mounted.container.textContent).toContain(
      'it is no longer available or compatible. Choose another model before sending.',
    )

    const textarea = mounted.container.querySelector<HTMLTextAreaElement>('.ai-input-box textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setter.call(textarea, 'This must not send')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => mounted.container.querySelector<HTMLButtonElement>('.ai-send-btn')!.click())
    expect(apis.aiStream).not.toHaveBeenCalled()

    act(() => trigger.click())
    const replacement = Array.from(
      document.querySelectorAll<HTMLElement>('.model-picker__option'),
    ).find((option) => option.textContent?.includes('Vision Model'))!
    act(() => replacement.click())
    await flushEffects()

    expect(apis.setAiConversationRoute).toHaveBeenCalledWith(
      { projectId: 'default', chatId: '0123456789abcdef' },
      visionRoute,
    )
    expect(mounted.container.textContent).toContain('Switched to Vision Model')

    mounted.cleanup()
    editor.destroy()
  })

  it('offers a working free-router retry without showing Genspark sign-in', async () => {
    const apis = installApis({
      route: limitedFreeRoute,
      loggedIn: false,
      streamError:
        'HTTP 429: This model is temporarily rate-limited by its upstream provider. Try again shortly or choose another model.',
    })
    const editor = createEditor()
    const mounted = mountPanel(editor)
    await flushEffects()

    const textarea = mounted.container.querySelector<HTMLTextAreaElement>('.ai-input-box textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setter.call(textarea, 'Write model information into the document')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => mounted.container.querySelector<HTMLButtonElement>('.ai-send-btn')!.click())
    await flushEffects()

    expect(mounted.container.textContent).toContain('temporarily rate-limited')
    expect(mounted.container.querySelector('.ai-login-btn')).toBeNull()
    expect(apis.aiGskStatus).not.toHaveBeenCalled()

    const fallback = mounted.container.querySelector<HTMLButtonElement>('.ai-retry-route-btn')!
    expect(fallback.textContent).toContain('OpenRouter Free Router')
    act(() => fallback.click())
    await flushEffects()
    await flushEffects()

    expect(apis.setAiConversationRoute).toHaveBeenCalledWith(
      { projectId: 'default', chatId: '0123456789abcdef' },
      freeRouterRoute,
    )
    expect(apis.aiStream).toHaveBeenCalledTimes(2)

    mounted.cleanup()
    editor.destroy()
  })
})
