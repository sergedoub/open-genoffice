import { describe, expect, it } from 'vitest'
import type { AiModelSummary } from '../src/types'
import {
  OPENROUTER_AUTO_MODEL_ID,
  OPENROUTER_FREE_MODEL_ID,
  isFreeModel,
  openRouterRetryRoute,
  openRouterRetrySuggestion,
} from '../src/retry'

function model(id: string, pricing?: AiModelSummary['pricing']): AiModelSummary {
  return {
    id,
    canonicalId: id,
    providerId: 'openrouter',
    name: id,
    expiresAt: null,
    available: true,
    capabilities: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
    },
    ...(pricing ? { pricing } : {}),
  }
}

describe('OpenRouter retry routing', () => {
  it('uses Auto Router after a paid-model failure', () => {
    const route = { providerId: 'openrouter' as const, modelId: 'openai/gpt-5' }
    expect(openRouterRetryRoute(route, model(route.modelId))).toEqual({
      providerId: 'openrouter',
      modelId: OPENROUTER_AUTO_MODEL_ID,
    })
    expect(openRouterRetrySuggestion(route, model(route.modelId))).toContain(
      `OpenRouter Auto Router (${OPENROUTER_AUTO_MODEL_ID})`,
    )
  })

  it('uses the free router for free model ids and zero-priced metadata', () => {
    expect(
      openRouterRetryRoute(
        { providerId: 'openrouter', modelId: 'qwen/qwen3:free' },
        model('qwen/qwen3:free'),
      ).modelId,
    ).toBe(OPENROUTER_FREE_MODEL_ID)
    expect(
      isFreeModel(model('community/model', { promptPerToken: 0, completionPerToken: 0 })),
    ).toBe(true)
    expect(
      openRouterRetrySuggestion({ providerId: 'openrouter', modelId: 'qwen/qwen3:free' }),
    ).toContain(`OpenRouter Free Router (${OPENROUTER_FREE_MODEL_ID})`)
  })
})
