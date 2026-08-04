import { describe, expect, it } from 'vitest'

import { toRichTextDocument } from '../src/renderer/univer-sync'
import { createEditJournal, recordSetRangeValues, toSaveEdits } from '../src/renderer/edit-journal'
import type { WorkbookRichRun } from '../src/shared/desktop-api'

const plainRun = (text: string): WorkbookRichRun => ({
  text,
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
})

describe('toRichTextDocument with line breaks', () => {
  it('converts \\n to Univer paragraph breaks with per-paragraph markers', () => {
    const p = toRichTextDocument('Line1\nLine2\nLine3')
    expect(p?.body?.dataStream).toBe('Line1\rLine2\rLine3\r\n')
    expect(p?.body?.paragraphs).toEqual([{ startIndex: 5 }, { startIndex: 11 }, { startIndex: 17 }])
    expect(p?.body?.sectionBreaks).toEqual([{ startIndex: 18 }])
    expect(p?.body?.textRuns).toEqual([])
  })

  it('keeps textRun offsets aligned across the 1:1 replacement', () => {
    const runs: WorkbookRichRun[] = [
      plainRun('Line1\nLine2\n'),
      { text: 'Line3', bold: false, italic: true, underline: true, strikethrough: false },
    ]
    const p = toRichTextDocument('Line1\nLine2\nLine3', runs)
    const styled = p?.body?.textRuns?.[1]
    expect(styled).toMatchObject({ st: 12, ed: 17, ts: { it: 1, ul: { s: 1 } } })
    expect(p?.body?.dataStream?.slice(styled!.st, styled!.ed)).toBe('Line3')
  })
})

describe('multiline round trip through the edit journal', () => {
  it('restores \\n in rich multi-run cells and keeps run boundaries', () => {
    const runs: WorkbookRichRun[] = [
      plainRun('Line1\nLine2\n'),
      { text: 'Line3', bold: false, italic: true, underline: true, strikethrough: false },
    ]
    const journal = createEditJournal()
    recordSetRangeValues(journal, 'sheet-1', {
      0: { 0: { p: toRichTextDocument('Line1\nLine2\nLine3', runs) } },
    })
    const entry = journal.cells.get('sheet-1')?.get('0:0')
    expect(entry?.value).toBe('Line1\nLine2\nLine3')
    expect(entry?.rich).toEqual(runs)
  })

  it('restores \\n in single-format cells (Alt+Enter, no styled runs)', () => {
    const journal = createEditJournal()
    recordSetRangeValues(journal, 'sheet-1', {
      0: { 0: { p: toRichTextDocument('foo\nbar\nbaz') } },
    })
    const entry = journal.cells.get('sheet-1')?.get('0:0')
    expect(entry?.value).toBe('foo\nbar\nbaz')
    expect(entry?.rich).toBeUndefined()
  })

  it('writes \\n to the save payload for editor-produced streams', () => {
    const journal = createEditJournal()
    recordSetRangeValues(journal, 'sheet-1', {
      0: { 0: { p: { body: { dataStream: 'edited\rin place\r\n' } } } },
    })
    const edits = toSaveEdits(journal)
    expect(edits).toHaveLength(1)
    expect(edits[0]?.value).toBe('edited\nin place')
    expect(edits[0]?.rich).toBeUndefined()
  })
})
