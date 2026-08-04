import { describe, expect, it } from 'vitest'
import type { Block, GeneratedBlock } from '@genoffice/docx-engine'
import {
  inlineToRuns,
  signatureOfBlock,
  signatureOfGenerated,
  type PmNode,
} from '../src/renderer/editor/convert'

describe('inlineToRuns hard break after atomic runs', () => {
  it('does not append the break char to a footnote reference run', () => {
    const inline: PmNode[] = [
      { type: 'text', text: 'before' },
      { type: 'docNoteRef', attrs: { kind: 'footnote', id: '3', num: 3 } },
      { type: 'hardBreak' },
      { type: 'text', text: 'after' },
    ]
    const runs = inlineToRuns(inline)
    const refRun = runs.find((r) => r.noteRef)
    expect(refRun?.text).toBe('3')
    expect(runs.map((r) => r.text).join('')).toBe('before3\nafter')
  })

  it('does not append the break char to an inline math run', () => {
    const inline: PmNode[] = [
      { type: 'docInlineMath', attrs: { omml: '<m:oMath/>', text: 'x' } },
      { type: 'hardBreak', attrs: { pageBreak: true } },
    ]
    const runs = inlineToRuns(inline)
    expect(runs[0]).toEqual({ text: 'x', math: { omml: '<m:oMath/>' } })
    expect(runs[1]).toEqual({ text: '\f' })
  })
})

describe('paragraph format signatures', () => {
  const base: Block = {
    id: 'b0',
    type: 'paragraph',
    docxIndex: 0,
    originalXml: '<w:p/>',
    runs: [{ text: 'a' }],
  }

  it('detects lineRule/lineRawTwips differences', () => {
    const generated: GeneratedBlock = { type: 'paragraph', runs: [{ text: 'a' }] }
    const withRule = signatureOfBlock({
      ...base,
      format: { lineRule: 'exact', lineRawTwips: 480 },
    })
    const without = signatureOfGenerated(generated)
    expect(withRule).not.toBe(without)
    const matching = signatureOfGenerated({
      ...generated,
      format: { lineRule: 'exact', lineRawTwips: 480 },
    })
    expect(withRule).toBe(matching)
  })

  it('detects bidi differences', () => {
    const ltr = signatureOfBlock(base)
    const rtl = signatureOfBlock({ ...base, format: { bidi: true } })
    expect(ltr).not.toBe(rtl)
  })
})
