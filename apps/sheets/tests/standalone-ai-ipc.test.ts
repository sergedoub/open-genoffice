import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseProjectLoadArgs } from '../../docs/src/main/ai-routing-ipc'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/main/sheets-main.ts'),
  'utf8',
)
const transport = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/ai/transport.ts'),
  'utf8',
)
const preload = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/preload/index.ts'),
  'utf8',
)

describe('Sheets standalone secure AI bootstrap', () => {
  it('uses the shared credential-safe router and hardened project parsers', () => {
    expect(source).toContain('registerAiRoutingIpc({')
    expect(source).toContain('parseProjectResolveArgs(value)')
    expect(source).toContain('parseProjectAppendArgs(value)')
    expect(source).toContain('parseProjectLoadArgs(value)')
    expect(source).toContain('parseProjectRebindArgs(value)')
    expect(source).not.toContain('request.settings')
    expect(() => parseProjectLoadArgs({ projectId: 'default', chatId: '../../outside' })).toThrow(
      /chatId is invalid/,
    )
  })

  it('has no renderer fallback that serializes provider settings', () => {
    expect(transport).not.toContain('createIpcTransport')
    expect(transport).not.toContain('getSettings:')
    expect(transport).not.toContain('settings: request')
    expect(preload).not.toContain(
      'aiStream(request) {\n    await ipcRenderer.invoke(IPC_CHANNELS.aiStream, request)',
    )
    expect(preload).not.toContain('aiChat, request)')
  })
})
