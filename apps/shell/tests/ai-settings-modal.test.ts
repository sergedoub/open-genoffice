// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@genoffice/ui', () => ({
  ModelPicker: ({
    onOpen,
    onSelectionChange,
  }: {
    onOpen?: () => void
    onSelectionChange: (model: {
      providerId: string
      modelId: string
      providerLabel: string
      label: string
    }) => void
  }) =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        'button',
        { type: 'button', 'data-testid': 'model-picker', onClick: onOpen },
        'picker',
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'pick-genspark',
          onClick: () =>
            onSelectionChange({
              providerId: 'genspark',
              modelId: 'claude-opus-4-7',
              providerLabel: 'Genspark',
              label: 'Genspark',
            }),
        },
        'pick Genspark',
      ),
    ),
}))

import { AiSettingsModal, toModelPickerModels } from '../src/renderer/src/settings/AiSettingsModal'

const modelResult = {
  models: [
    {
      id: 'gpt-5',
      canonicalId: 'gpt-5',
      providerId: 'genspark' as const,
      name: 'GPT-5',
      available: true,
      capabilities: {
        inputModalities: ['text'],
        outputModalities: ['text'],
        supportsTools: true,
        contextWindow: null,
        maxOutputTokens: null,
      },
    },
  ],
  catalogs: [
    {
      providerId: 'genspark' as const,
      fetchedAt: '2026-08-04T00:00:00.000Z',
      stale: false,
    },
  ],
}

const settings = {
  schemaVersion: 1 as const,
  globalDefault: { providerId: 'genspark' as const, modelId: 'gpt-5' },
  providers: [
    { id: 'genspark' as const, label: 'Genspark', status: 'connected' as const, hasApiKey: false },
    {
      id: 'openrouter' as const,
      label: 'OpenRouter',
      status: 'not-configured' as const,
      hasApiKey: false,
    },
    {
      id: 'anthropic' as const,
      label: 'Anthropic',
      status: 'not-configured' as const,
      hasApiKey: false,
    },
    { id: 'openai' as const, label: 'OpenAI', status: 'not-configured' as const, hasApiKey: false },
  ],
  secureStorageAvailable: true,
}

describe('AiSettingsModal', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function createApi() {
    return {
      getAiPublicSettings: vi.fn(async () => settings),
      setAiGlobalDefault: vi.fn(async () => settings),
      verifyAndSaveAiProvider: vi.fn(),
      removeAiProviderKey: vi.fn(async () => settings),
      listAiModels: vi.fn(async () => modelResult),
      refreshAiModels: vi.fn(async () => modelResult),
    }
  }

  it('always exposes one Genspark bundle option when signed out', () => {
    const signedOutProviders = settings.providers.map((provider) =>
      provider.id === 'genspark' ? { ...provider, status: 'unavailable' as const } : provider,
    )
    const pickerModels = toModelPickerModels([], signedOutProviders)

    expect(pickerModels.filter((model) => model.providerId === 'genspark')).toEqual([
      expect.objectContaining({
        providerId: 'genspark',
        providerLabel: 'Genspark',
        label: 'Genspark',
        shortLabel: 'Genspark',
      }),
    ])
  })

  it('guides signed-out Genspark selection to sign-in without changing the default', async () => {
    const signedOutSettings = {
      ...settings,
      globalDefault: { providerId: 'openai' as const, modelId: 'gpt-5' },
      providers: settings.providers.map((provider) =>
        provider.id === 'genspark' ? { ...provider, status: 'unavailable' as const } : provider,
      ),
    }
    const api = {
      ...createApi(),
      accountLogin: vi.fn(async () => true),
      getAiPublicSettings: vi.fn(async () => signedOutSettings),
    }

    await act(async () => {
      root.render(React.createElement(AiSettingsModal, { api, onClose: vi.fn() }))
      await Promise.resolve()
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="pick-genspark"]')?.click()
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
    })

    expect(api.setAiGlobalDefault).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Sign in to Genspark to use it as your default model.')
    expect(document.activeElement).toBe(
      container.querySelector<HTMLButtonElement>('[data-genspark-sign-in]'),
    )
  })

  it('renders the concise settings copy and API key links', async () => {
    const api = createApi()
    await act(async () => {
      root.render(React.createElement(AiSettingsModal, { api, onClose: vi.fn() }))
      await Promise.resolve()
    })

    const text = container.textContent ?? ''
    expect(text).not.toContain('Connect providers and choose the default model for new documents.')
    expect(text).not.toContain('New document conversations start with this model.')
    expect(text).not.toContain('Existing documents keep their selection.')
    expect(text).not.toContain('compatible models available')
    expect(text).not.toContain('Refresh models')
    expect(
      container.querySelector('a[href="https://platform.openai.com/api-keys"]')?.textContent,
    ).toBe('Get your OpenAI key')
    expect(
      container.querySelector(
        'a[href="https://platform.claude.com/settings/workspaces/default/keys"]',
      )?.textContent,
    ).toBe('Get your Anthropic key')
  })

  it('refreshes on picker open only after the freshness interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const api = createApi()
    await act(async () => {
      root.render(React.createElement(AiSettingsModal, { api, onClose: vi.fn() }))
      await Promise.resolve()
    })

    const picker = container.querySelector<HTMLButtonElement>('[data-testid="model-picker"]')
    expect(picker).not.toBeNull()
    await act(async () => picker?.click())
    expect(api.refreshAiModels).not.toHaveBeenCalled()

    vi.setSystemTime(1_000_000 + 5 * 60 * 1000)
    await act(async () => picker?.click())
    expect(api.refreshAiModels).toHaveBeenCalledOnce()
  })
})
