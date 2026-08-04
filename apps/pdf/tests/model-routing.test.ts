import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AiModelSummary } from '@genoffice/ai-provider'
import {
  isPdfCompatibleModel,
  latestTranscriptRoute,
  modelCompactionBudget,
  restorePdfTranscript,
} from '../src/renderer/ai/model-routing'
import { toRouteOnlyAiStreamRequest } from '../src/shared/ipc'

function model(overrides: Partial<AiModelSummary> = {}): AiModelSummary {
  return {
    id: 'provider/model',
    canonicalId: 'provider/model',
    providerId: 'openrouter',
    name: 'Model',
    expiresAt: null,
    available: true,
    capabilities: {
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsTools: true,
      contextWindow: 128_000,
      maxOutputTokens: 8_000,
    },
    ...overrides,
  }
}

describe('PDF model routing', () => {
  it('persists before commit, rolls back failures, and never fabricates resolved provenance', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/ai/AiPanel.tsx'), 'utf8')
    const switchStart = source.indexOf('const selectModel =')
    const switchEnd = source.indexOf('const stop =', switchStart)
    const switchSource = source.slice(switchStart, switchEnd)

    expect(switchSource.indexOf('setAiConversationRoute(identity, route)')).toBeGreaterThan(
      switchSource.indexOf('prepareModelSwitch'),
    )
    expect(switchSource.indexOf('preparation?.commit()')).toBeGreaterThan(
      switchSource.indexOf('setAiConversationRoute(identity, route)'),
    )
    expect(switchSource).toContain('preparation?.rollback()')
    expect(source).not.toContain('resolved: route')
  })

  it('shows only available text models with text output and tools', () => {
    expect(isPdfCompatibleModel(model())).toBe(true)
    expect(isPdfCompatibleModel(model({ available: false }))).toBe(false)
    expect(
      isPdfCompatibleModel(
        model({ capabilities: { ...model().capabilities, supportsTools: false } }),
      ),
    ).toBe(false)
    expect(
      isPdfCompatibleModel(
        model({ capabilities: { ...model().capabilities, outputModalities: ['image'] } }),
      ),
    ).toBe(false)
  })

  it('derives a conservative incoming-model compaction budget', () => {
    expect(modelCompactionBudget(model())).toEqual({
      maxBytes: 307_200,
      keepRecentBytes: 115_200,
    })
  })

  it('reconstructs model switch dividers from assistant provenance', () => {
    const messages = [
      {
        seq: 1,
        ts: '2026-08-03T00:00:00.000Z',
        role: 'user' as const,
        text: 'First',
      },
      {
        seq: 2,
        ts: '2026-08-03T00:00:01.000Z',
        role: 'assistant' as const,
        text: 'One',
        ai: { requested: { providerId: 'genspark' as const, modelId: 'gpt-5' } },
      },
      {
        seq: 3,
        ts: '2026-08-03T00:00:02.000Z',
        role: 'user' as const,
        text: 'Second',
      },
      {
        seq: 4,
        ts: '2026-08-03T00:00:03.000Z',
        role: 'assistant' as const,
        text: 'Two',
        ai: { requested: { providerId: 'openrouter' as const, modelId: 'vendor/new' } },
      },
    ]

    expect(restorePdfTranscript(messages)).toEqual([
      { role: 'user', text: 'First' },
      { role: 'assistant', text: 'One' },
      { role: 'user', text: 'Second' },
      { role: 'divider', text: 'Switched to vendor/new' },
      { role: 'assistant', text: 'Two' },
    ])
    expect(latestTranscriptRoute(messages)).toEqual({
      providerId: 'openrouter',
      modelId: 'vendor/new',
    })
  })

  it('strips renderer-supplied provider settings from stream IPC payloads', () => {
    const payload = toRouteOnlyAiStreamRequest({
      requestId: 'request-1',
      conversation: { projectId: 'default', chatId: '0123456789abcdef' },
      system: 'system',
      messages: [{ role: 'user', text: 'hello' }],
      settings: { apiKey: 'must-not-cross-ipc' },
    } as never)

    expect(payload).toEqual({
      requestId: 'request-1',
      conversation: { projectId: 'default', chatId: '0123456789abcdef' },
      system: 'system',
      messages: [{ role: 'user', text: 'hello' }],
    })
    expect(JSON.stringify(payload)).not.toContain('must-not-cross-ipc')
  })
})
