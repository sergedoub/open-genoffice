import { describe, expect, it } from 'vitest'
import {
  filterModelPickerModels,
  findModelPickerSelection,
  groupModelPickerModels,
  MODEL_PICKER_PROVIDER_ORDER,
  nextModelPickerIndex,
  type ModelPickerModel,
} from '../src/model-picker'

const models: readonly ModelPickerModel[] = [
  {
    providerId: 'openrouter',
    providerLabel: 'OpenRouter',
    modelId: 'anthropic/claude-sonnet-4',
    label: 'Claude Sonnet 4',
    capabilityLabels: ['Vision', 'Tools'],
  },
  {
    providerId: 'openrouter',
    providerLabel: 'OpenRouter',
    modelId: 'openai/gpt-5',
    label: 'GPT-5',
  },
  {
    providerId: 'anthropic',
    providerLabel: 'Anthropic',
    modelId: 'claude-opus-4',
    label: 'Claude Opus 4',
    searchTerms: ['reasoning'],
  },
]

describe('filterModelPickerModels', () => {
  it('matches display name, slug, provider, and caller-supplied search terms', () => {
    expect(filterModelPickerModels(models, 'sonnet').map((model) => model.modelId)).toEqual([
      'anthropic/claude-sonnet-4',
    ])
    expect(filterModelPickerModels(models, 'openrouter gpt').map((model) => model.modelId)).toEqual(
      ['openai/gpt-5'],
    )
    expect(filterModelPickerModels(models, 'reasoning').map((model) => model.modelId)).toEqual([
      'claude-opus-4',
    ])
  })

  it('returns all models for blank search without mutating the input', () => {
    const result = filterModelPickerModels(models, '  ')
    expect(result).toEqual(models)
    expect(result).not.toBe(models)
  })
})

describe('groupModelPickerModels', () => {
  it('preserves provider and row ordering', () => {
    expect(groupModelPickerModels(models)).toEqual([
      {
        providerId: 'openrouter',
        providerLabel: 'OpenRouter',
        models: [models[0], models[1]],
      },
      {
        providerId: 'anthropic',
        providerLabel: 'Anthropic',
        models: [models[2]],
      },
    ])
  })

  it('supports the product provider order without changing default grouping semantics', () => {
    expect(
      groupModelPickerModels(models, MODEL_PICKER_PROVIDER_ORDER).map((group) => group.providerId),
    ).toEqual(['openrouter', 'anthropic'])
  })
})

describe('findModelPickerSelection', () => {
  it('matches the provider and model together', () => {
    expect(
      findModelPickerSelection(models, {
        providerId: 'anthropic',
        modelId: 'claude-opus-4',
      }),
    ).toBe(models[2])
    expect(
      findModelPickerSelection(models, {
        providerId: 'openrouter',
        modelId: 'claude-opus-4',
      }),
    ).toBeUndefined()
  })
})

describe('nextModelPickerIndex', () => {
  it('wraps keyboard navigation in both directions', () => {
    expect(nextModelPickerIndex(-1, 3, 1)).toBe(0)
    expect(nextModelPickerIndex(-1, 3, -1)).toBe(2)
    expect(nextModelPickerIndex(2, 3, 1)).toBe(0)
    expect(nextModelPickerIndex(0, 3, -1)).toBe(2)
    expect(nextModelPickerIndex(0, 0, 1)).toBe(-1)
  })
})
