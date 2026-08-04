import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchOpenRouterModelCatalog,
  filterCompatibleModels,
  normalizeOpenRouterModels,
} from '../src/catalog'
import { jsonResponse } from './test-utils'

afterEach(() => {
  vi.unstubAllGlobals()
})

const now = new Date('2026-08-03T12:00:00.000Z')

function openRouterModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 'anthropic/claude-test',
    canonical_slug: 'anthropic/claude-test-20260801',
    name: 'Claude Test',
    description: 'A tool-capable test model',
    created: 1_754_006_400,
    context_length: 200_000,
    architecture: {
      input_modalities: ['text', 'image', 'file'],
      output_modalities: ['text'],
    },
    supported_parameters: ['tools', 'temperature'],
    top_provider: { max_completion_tokens: 32_000 },
    pricing: {
      prompt: '0.000003',
      completion: '0.000015',
      image: '0.0012',
      request: '0',
    },
    expiration_date: '2027-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('normalizeOpenRouterModels', () => {
  it('normalizes modalities, context, pricing, timestamps and expiry', () => {
    const models = normalizeOpenRouterModels({ data: [openRouterModel()] }, now)

    expect(models).toEqual([
      {
        id: 'anthropic/claude-test',
        canonicalId: 'anthropic/claude-test-20260801',
        providerId: 'openrouter',
        name: 'Claude Test',
        description: 'A tool-capable test model',
        createdAt: '2025-08-01T00:00:00.000Z',
        expiresAt: '2027-01-01T00:00:00Z',
        available: true,
        capabilities: {
          inputModalities: ['text', 'image', 'file'],
          outputModalities: ['text'],
          supportsTools: true,
          contextWindow: 200_000,
          maxOutputTokens: 32_000,
        },
        pricing: {
          promptPerToken: 0.000003,
          completionPerToken: 0.000015,
          image: 0.0012,
          request: 0,
        },
      },
    ])
  })

  it('fails closed on malformed records, expiry dates and capability metadata', () => {
    const models = normalizeOpenRouterModels(
      {
        data: [
          null,
          { name: 'missing id' },
          openRouterModel({ id: 'bad-expiry', expiration_date: 'not-a-date' }),
          openRouterModel({
            id: 'bad-fields',
            architecture: { input_modalities: ['text', 'unknown'], output_modalities: 'text' },
            context_length: -1,
            pricing: {
              prompt: 'unknown',
              completion: '0.000015',
              image: '0.0012',
              request: '0',
            },
          }),
        ],
      },
      now,
    )

    expect(models).toHaveLength(2)
    expect(models[0]).toMatchObject({ id: 'bad-expiry', available: false })
    expect(models[1]).toMatchObject({
      id: 'bad-fields',
      capabilities: {
        inputModalities: ['text'],
        outputModalities: [],
        contextWindow: null,
      },
    })
    expect(models[1]!.pricing).toEqual({ completionPerToken: 0.000015, image: 0.0012, request: 0 })
  })
})

describe('filterCompatibleModels', () => {
  it('keeps only available text-in/text-out models with tool calling', () => {
    const models = normalizeOpenRouterModels(
      {
        data: [
          openRouterModel({ id: 'compatible' }),
          openRouterModel({ id: 'no-tools', supported_parameters: ['temperature'] }),
          openRouterModel({
            id: 'no-text-input',
            architecture: { input_modalities: ['image'], output_modalities: ['text'] },
          }),
          openRouterModel({
            id: 'no-text-output',
            architecture: { input_modalities: ['text'], output_modalities: ['image'] },
          }),
          openRouterModel({ id: 'expired', expiration_date: '2026-08-03T11:59:59Z' }),
          openRouterModel({ id: 'inactive', status: 'inactive' }),
        ],
      },
      now,
    )

    expect(filterCompatibleModels(models).map((model) => model.id)).toEqual(['compatible'])
  })

  it('can require image input for an image-bearing conversation', () => {
    const models = normalizeOpenRouterModels(
      {
        data: [
          openRouterModel({ id: 'vision' }),
          openRouterModel({
            id: 'text-only',
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
          }),
        ],
      },
      now,
    )

    expect(filterCompatibleModels(models).map((model) => model.id)).toEqual(['vision', 'text-only'])
    expect(filterCompatibleModels(models, { imageInput: true }).map((model) => model.id)).toEqual([
      'vision',
    ])
  })
})

describe('fetchOpenRouterModelCatalog', () => {
  it('uses the authenticated user catalog and returns compatible models with cache metadata', async () => {
    const response = jsonResponse({
      data: [
        openRouterModel({ id: 'compatible' }),
        openRouterModel({ id: 'no-tools', supported_parameters: [] }),
      ],
    })
    response.headers.set('cache-control', 'public, max-age=300')
    response.headers.set('etag', '"models-v1"')
    const fetchMock = vi.fn().mockResolvedValue(response)

    const catalog = await fetchOpenRouterModelCatalog('sk-or-secret', { fetch: fetchMock, now })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models/user',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer sk-or-secret' },
      }),
    )
    expect(catalog).toMatchObject({
      providerId: 'openrouter',
      fetchedAt: now.toISOString(),
      cacheControl: 'public, max-age=300',
      etag: '"models-v1"',
    })
    expect(catalog.models.map((model) => model.id)).toEqual(['compatible'])
  })

  it('rejects missing keys, HTTP errors and malformed successful responses', async () => {
    const fetchMock = vi.fn()
    await expect(fetchOpenRouterModelCatalog('', { fetch: fetchMock })).rejects.toThrow(
      /key is required/,
    )
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(new Response('rejected key sk-or-secret', { status: 401 }))
    const failed = fetchOpenRouterModelCatalog('sk-or-secret', { fetch: fetchMock })
    await expect(failed).rejects.toThrow(/models HTTP 401: rejected key \[REDACTED\]/)
    await expect(failed).rejects.not.toThrow(/sk-or-secret/)

    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [] }))
    await expect(fetchOpenRouterModelCatalog('key', { fetch: fetchMock })).rejects.toThrow(
      /invalid response/,
    )
  })
})
