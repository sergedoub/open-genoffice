import { describe, expect, it } from 'vitest'
import { DOCS_AGENT_MAX_TURNS, DOCS_CONTINUE_INSTRUCTION } from '../src/renderer/ai/continuation'

describe('Docs AI continuation', () => {
  it('uses the expanded turn budget', () => {
    expect(DOCS_AGENT_MAX_TURNS).toBe(50)
  })

  it('instructs continuation to preserve completed work', () => {
    expect(DOCS_CONTINUE_INSTRUCTION).toContain('existing conversation and document state')
    expect(DOCS_CONTINUE_INSTRUCTION).toContain('only the outstanding work')
    expect(DOCS_CONTINUE_INSTRUCTION).toContain('Do not repeat edits')
  })
})
