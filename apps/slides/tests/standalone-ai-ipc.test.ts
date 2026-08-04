import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseProjectRebindArgs } from '../../docs/src/main/ai-routing-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const main = readFileSync(join(here, '../src/main/slides-main.ts'), 'utf8')
const slidesOnly = readFileSync(join(here, '../src/main/ai-ipc.ts'), 'utf8')

describe('Slides standalone secure AI bootstrap', () => {
  it('keeps shared routing separate from Slides-only AI channels', () => {
    expect(main).toContain('registerAiRoutingIpc({')
    expect(main).toContain('registerSlidesOnlyAiIpc()')
    expect(slidesOnly).not.toContain('export function registerAiIpc')
    expect(slidesOnly).not.toContain("ipcMain.handle('ai:stream'")
  })

  it('runs every project operation through the central hardened parsers', () => {
    expect(main).toContain('parseProjectResolveArgs(value)')
    expect(main).toContain('parseProjectAppendArgs(value)')
    expect(main).toContain('parseProjectLoadArgs(value)')
    expect(main).toContain('parseProjectRebindArgs(value)')
    expect(() =>
      parseProjectRebindArgs({
        projectId: 'default',
        tempChatId: 'unsaved-safe',
        newChatId: '../outside',
      }),
    ).toThrow(/newChatId is invalid/)
  })
})
