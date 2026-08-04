import { act, createElement } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type {
  AiConversationIdentity,
  AiModelSummary,
  AiRoute,
  PublicAiSettings,
  SlidesApi,
} from '../src/shared/ipc'
import type { ChatMessage, ProjectApi } from '@genoffice/project-store'

vi.mock('react-konva', () => {
  const stub = () => null
  return {
    Stage: stub,
    Layer: stub,
    Rect: stub,
    Group: stub,
    Transformer: stub,
    Line: stub,
    Arrow: stub,
    Text: stub,
    Ellipse: stub,
    Image: stub,
    Path: stub,
    Circle: stub,
    Arc: stub,
  }
})

import { AiPanel } from '../src/renderer/ai/AiPanel'

function model(id: string, image = false): AiModelSummary {
  return {
    id,
    canonicalId: `openrouter/${id}`,
    providerId: 'openrouter',
    name: id === 'vision' ? 'Vision Model' : 'Text Model',
    expiresAt: null,
    available: true,
    capabilities: {
      inputModalities: image ? ['text', 'image'] : ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
    },
  }
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  })
}

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

describe('Slides per-presentation model picker', () => {
  it('does not fabricate resolved model provenance', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/ai/AiPanel.tsx'), 'utf8')
    expect(source).not.toContain('resolved: activeRunRouteRef.current')
  })

  it('normalizes an unsaved presentation empty path before resolving its chat', async () => {
    const resolveChat = vi.fn(async () => ({ projectId: 'default', chatId: 'unsaved-test' }))
    Object.assign(window, {
      projectApi: {
        resolveChat,
        loadChat: vi.fn(async () => []),
        appendChat: vi.fn(async () => {}),
      } satisfies Partial<ProjectApi>,
      slidesApi: {
        getAiPublicSettings: vi.fn(async (): Promise<PublicAiSettings> => ({
          schemaVersion: 1,
          globalDefault: { providerId: 'genspark', modelId: 'genspark' },
          providers: [],
          secureStorageAvailable: true,
        })),
        listAiModels: vi.fn(async () => ({ models: [], catalogs: [] })),
        getAiConversationRoute: vi.fn(async (): Promise<AiRoute> => ({
          providerId: 'genspark',
          modelId: 'genspark',
        })),
        onAiStream: vi.fn(() => () => {}),
      } satisfies Partial<SlidesApi>,
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        createElement(AiPanel, {
          slides: [],
          current: 0,
          selectedIds: [],
          images: new Map(),
          applySlide: () => {},
          applyDeck: () => {},
          fitWidthPx: 960,
          currentFilePath: '',
        }),
      ),
    )
    await flush()

    expect(resolveChat).toHaveBeenCalledWith({
      filePath: null,
      tempChatId: expect.stringMatching(/^unsaved-/),
    })

    act(() => root.unmount())
    container.remove()
  })

  it('preserves an incompatible saved route, blocks send, then switches through main in-place', async () => {
    const text = model('text')
    const vision = model('vision', true)
    const setRoute = vi
      .fn<(identity: AiConversationIdentity, route: AiRoute) => Promise<AiRoute>>()
      .mockRejectedValueOnce(new Error('Route write failed'))
      .mockImplementation(async (_identity, route) => route)
    const history: ChatMessage[] = [
      {
        seq: 1,
        ts: new Date().toISOString(),
        role: 'user',
        text: 'Use this image in the deck',
        attachments: [{ name: 'reference.png', ext: 'png' }],
      },
    ]
    const publicSettings: PublicAiSettings = {
      schemaVersion: 1,
      globalDefault: { providerId: 'openrouter', modelId: 'text' },
      providers: [
        {
          id: 'openrouter',
          label: 'OpenRouter',
          status: 'connected',
          hasApiKey: true,
        },
      ],
      secureStorageAvailable: true,
    }

    Object.assign(window, {
      projectApi: {
        resolveChat: vi.fn(async () => ({ projectId: 'default', chatId: 'deck-chat' })),
        loadChat: vi.fn(async () => history),
        appendChat: vi.fn(async () => {}),
      } satisfies Partial<ProjectApi>,
      slidesApi: {
        getAiPublicSettings: vi.fn(async () => publicSettings),
        listAiModels: vi.fn(async () => ({ models: [text, vision], catalogs: [] })),
        getAiConversationRoute: vi.fn(async (): Promise<AiRoute> => ({
          providerId: 'openrouter',
          modelId: 'text',
        })),
        setAiConversationRoute: setRoute,
        onAiStream: vi.fn(() => () => {}),
        aiStream: vi.fn(async () => {}),
        aiStreamCancel: vi.fn(async () => {}),
      } satisfies Partial<SlidesApi>,
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        createElement(AiPanel, {
          slides: [],
          current: 0,
          selectedIds: [],
          images: new Map(),
          applySlide: () => {},
          applyDeck: () => {},
          fitWidthPx: 960,
        }),
      ),
    )
    await flush()

    expect(container.querySelector('.ai-model-notice')?.textContent).toContain('unavailable')
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    setTextareaValue(textarea, 'Continue')
    expect(container.querySelector<HTMLButtonElement>('.ai-send-btn')?.disabled).toBe(true)

    const picker = container.querySelector<HTMLButtonElement>(
      '[aria-label="Choose a model for this presentation"]',
    )!
    act(() => picker.click())
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    expect(options.filter((option) => option.textContent?.includes('Text Model'))).toHaveLength(1)
    const visionOption = options.find((option) => option.textContent?.includes('Vision Model'))!
    act(() => visionOption.click())
    await flush()

    expect(container.querySelector('.ai-model-notice')?.textContent).toContain('Route write failed')
    expect(container.querySelector('.ai-model-switch-divider')).toBeNull()
    expect(picker.textContent).toContain('Text Model')

    act(() => picker.click())
    const retryVisionOption = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes('Vision Model'))!
    act(() => retryVisionOption.click())
    await flush()

    expect(setRoute).toHaveBeenCalledWith(
      { projectId: 'default', chatId: 'deck-chat' },
      { providerId: 'openrouter', modelId: 'vision' },
    )
    expect(setRoute).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.ai-model-switch-divider')?.textContent).toBe(
      'Switched to Vision Model',
    )
    expect(container.querySelector<HTMLButtonElement>('.ai-send-btn')?.disabled).toBe(false)

    act(() => root.unmount())
    container.remove()
  })
})
