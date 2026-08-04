import { describe, expect, it } from 'vitest'
import type { AiModelSummary, PublicAiProvider } from '../src/shared/ipc'
import {
  compatibleModels,
  modelCompactionBudget,
  modelForRoute,
  modelSupportsImages,
  toPickerModel,
} from '../src/renderer/ai/model-routing'

function model(
  id: string,
  overrides: Partial<AiModelSummary['capabilities']> = {},
  available = true,
): AiModelSummary {
  return {
    id,
    canonicalId: `openrouter/${id}`,
    providerId: 'openrouter',
    name: id,
    expiresAt: null,
    available,
    capabilities: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      ...overrides,
    },
  }
}

describe('Slides model routing', () => {
  it('shows only available text/tool models and requires image support for image history', () => {
    const textOnly = model('text-only')
    const vision = model('vision', { inputModalities: ['text', 'image'] })
    const noTools = model('no-tools', { supportsTools: false })
    const unavailable = model('retired', {}, false)

    expect(compatibleModels([textOnly, vision, noTools, unavailable], false)).toEqual([
      textOnly,
      vision,
    ])
    expect(compatibleModels([textOnly, vision, noTools, unavailable], true)).toEqual([vision])
    expect(modelSupportsImages(textOnly)).toBe(false)
    expect(modelSupportsImages(vision)).toBe(true)
  })

  it('maps the provider-neutral catalog into the unified picker', () => {
    const vision = model('vision', { inputModalities: ['text', 'image'] })
    const providers: PublicAiProvider[] = [
      {
        id: 'openrouter',
        label: 'OpenRouter',
        status: 'connected',
        hasApiKey: true,
      },
    ]

    expect(toPickerModel(vision, providers)).toMatchObject({
      providerId: 'openrouter',
      modelId: 'vision',
      providerLabel: 'OpenRouter',
      capabilityLabels: ['Images', '128K context'],
    })
    expect(modelForRoute([vision], { providerId: 'openrouter', modelId: 'vision' })).toBe(vision)
  })

  it('derives a conservative incoming-model compaction budget', () => {
    expect(modelCompactionBudget(model('small', { contextWindow: 10_000 }))).toEqual({
      maxBytes: 32_000,
      keepRecentBytes: 12_000,
    })
    expect(modelCompactionBudget(model('unknown', { contextWindow: null }))).toBe(false)
  })
})
