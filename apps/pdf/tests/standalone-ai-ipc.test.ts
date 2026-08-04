import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseProjectResolveArgs } from '../../docs/src/main/ai-routing-ipc'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/main/pdf-main.ts'),
  'utf8',
)

describe('PDF standalone secure AI bootstrap', () => {
  it('registers secure AI and project handlers only in standalone mode', () => {
    expect(source).toContain('registerPdfStandaloneAiIpc()')
    expect(source).toContain('registerPdfStandaloneProjectIpc()')
    expect(source).toContain('registerAiRoutingIpc({')
  })

  it('runs every project operation through the central hardened parsers', () => {
    expect(source).toContain('parseProjectResolveArgs(value)')
    expect(source).toContain('parseProjectAppendArgs(value)')
    expect(source).toContain('parseProjectLoadArgs(value)')
    expect(source).toContain('parseProjectRebindArgs(value)')
    expect(() => parseProjectResolveArgs({ filePath: '/tmp/../outside.pdf' })).toThrow(
      /filePath is invalid/,
    )
  })
})
