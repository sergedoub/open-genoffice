import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AiModelSummary } from '@genoffice/ai-provider'
import {
  compactionForModel,
  compatibleModels,
  hasImageAttachments,
  modelSupportsImage,
  partitionAttachmentsForModel,
  preserveUnavailableSelection,
  publicAiBridge,
  routeModel,
  toPickerModels,
} from '../src/renderer/ai/model-routing'
import { buildPublicStreamRequest } from '../src/renderer/ai/transport'

function model(
  id: string,
  overrides: Partial<AiModelSummary['capabilities']> & { available?: boolean } = {},
): AiModelSummary {
  return {
    id,
    canonicalId: `openrouter/${id}`,
    providerId: 'openrouter',
    name: id,
    expiresAt: null,
    available: overrides.available ?? true,
    capabilities: {
      inputModalities: overrides.inputModalities ?? ['text'],
      outputModalities: overrides.outputModalities ?? ['text'],
      supportsTools: overrides.supportsTools ?? true,
      contextWindow: overrides.contextWindow === undefined ? 128_000 : overrides.contextWindow,
      maxOutputTokens: overrides.maxOutputTokens === undefined ? 8_192 : overrides.maxOutputTokens,
    },
  }
}

describe('Sheets AI model routing', () => {
  it('persists before commit, rolls back failures, and never fabricates resolved provenance', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
    const switchStart = source.indexOf('async function handleModelChange')
    const switchEnd = source.indexOf('function handleRemoveAttachment', switchStart)
    const switchSource = source.slice(switchStart, switchEnd)

    expect(switchSource.indexOf('setAiConversationRoute(ids, route)')).toBeGreaterThan(
      switchSource.indexOf('prepareModelSwitch'),
    )
    expect(switchSource.indexOf('preparation?.commit()')).toBeGreaterThan(
      switchSource.indexOf('setAiConversationRoute(ids, route)'),
    )
    expect(switchSource).toContain('preparation?.rollback()')
    expect(source).not.toContain('resolved: route')
  })

  it('shows only available text/tool models and requires vision after image context exists', () => {
    const text = model('text')
    const vision = model('vision', { inputModalities: ['text', 'image'] })
    const noTools = model('no-tools', { supportsTools: false })
    const unavailable = model('unavailable', { available: false })

    expect(compatibleModels([text, vision, noTools, unavailable]).map((item) => item.id)).toEqual([
      'text',
      'vision',
    ])
    expect(compatibleModels([text, vision], true).map((item) => item.id)).toEqual(['vision'])
    expect(modelSupportsImage(text)).toBe(false)
    expect(modelSupportsImage(vision)).toBe(true)
  })

  it('maps catalog rows to the unified picker and resolves an exact route', () => {
    const vision = model('vision', { inputModalities: ['text', 'image'] })
    const picker = toPickerModels([vision], new Map([['openrouter', 'OpenRouter']]))

    expect(picker[0]).toMatchObject({
      providerId: 'openrouter',
      modelId: 'vision',
      providerLabel: 'OpenRouter',
      capabilityLabels: ['Images', '128K context'],
    })
    expect(routeModel([vision], { providerId: 'openrouter', modelId: 'vision' })).toBe(vision)
    expect(routeModel([vision], { providerId: 'openrouter', modelId: 'missing' })).toBeUndefined()
  })

  it('rejects only image attachments for a text-only route', () => {
    const attachments = [
      { path: '/tmp/report.csv', name: 'report.csv', ext: 'csv', sizeBytes: 10 },
      { path: '/tmp/chart.png', name: 'chart.png', ext: 'png', sizeBytes: 20 },
    ]
    const partitioned = partitionAttachmentsForModel(attachments, false)

    expect(partitioned.accepted.map((item) => item.name)).toEqual(['report.csv'])
    expect(partitioned.rejectedImages.map((item) => item.name)).toEqual(['chart.png'])
    expect(hasImageAttachments(attachments)).toBe(true)
  })

  it('derives a conservative incoming context budget for model switching', () => {
    expect(compactionForModel(model('small', { contextWindow: 16_000 }))).toEqual({
      maxBytes: 33_600,
      keepRecentBytes: 16_384,
    })
    expect(compactionForModel(model('unknown', { contextWindow: null }))).toEqual({})
  })

  it('recognizes the public API only when settings and catalog methods both exist', () => {
    expect(
      publicAiBridge({
        getAiPublicSettings() {},
        listAiModels() {},
        getAiConversationRoute() {},
        setAiConversationRoute() {},
      }),
    ).not.toBeNull()
    expect(publicAiBridge({ getAiPublicSettings() {} })).toBeNull()
  })

  it('keeps a saved unavailable route visible until the user chooses a replacement', () => {
    const preserved = preserveUnavailableSelection(
      [],
      { providerId: 'openrouter', modelId: 'retired/model' },
      'retired/model',
      'OpenRouter',
      'No longer available',
    )

    expect(preserved).toEqual([
      expect.objectContaining({
        providerId: 'openrouter',
        modelId: 'retired/model',
        description: 'No longer available',
        capabilityLabels: ['Unavailable'],
      }),
    ])
  })

  it('builds a route-only stream request without renderer settings or credentials', () => {
    const request = buildPublicStreamRequest(
      'request-1',
      { projectId: 'default', chatId: 'chat-1' },
      {
        system: 'system',
        messages: [{ role: 'user', text: 'hello' }],
        tools: [],
      },
    )

    expect(request).toEqual({
      requestId: 'request-1',
      conversation: { projectId: 'default', chatId: 'chat-1' },
      system: 'system',
      messages: [{ role: 'user', text: 'hello' }],
      tools: [],
    })
    expect(request).not.toHaveProperty('settings')
    expect(JSON.stringify(request)).not.toContain('apiKey')
  })
})
