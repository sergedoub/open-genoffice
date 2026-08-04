import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import type { Run } from '@genoffice/docx-engine'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { inlineToRuns, runsToInline, type PmNode } from '../src/renderer/editor/convert'

function createEditor(content: PmNode[]): Editor {
  return new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: { type: 'doc', content },
  })
}

describe('footnote / endnote reference conversion', () => {
  it('maps Run.noteRef to a docNoteRef atom and back', () => {
    const runs: Run[] = [
      { text: 'body' },
      { text: '2', noteRef: { kind: 'footnote', id: '3' } },
      { text: 'continued' },
    ]
    const inline = runsToInline(runs)
    expect(inline).toEqual([
      { type: 'text', text: 'body' },
      { type: 'docNoteRef', attrs: { kind: 'footnote', id: '3', num: 2 } },
      { type: 'text', text: 'continued' },
    ])
    expect(inlineToRuns(inline)).toEqual(runs)
  })

  it('maps Run.xeTerm to a trailing docXeMark atom and back', () => {
    const runs: Run[] = [{ text: 'artificial intelligence', xeTerm: 'artificial intelligence' }]
    const inline = runsToInline(runs)
    expect(inline).toEqual([
      { type: 'text', text: 'artificial intelligence' },
      { type: 'docXeMark', attrs: { term: 'artificial intelligence' } },
    ])
    // splits back into a plain text run + an empty XE-carrier run
    expect(inlineToRuns(inline)).toEqual([
      { text: 'artificial intelligence' },
      { text: '', xeTerm: 'artificial intelligence' },
    ])
  })

  it('renders both atoms in the editor schema without dropping them', () => {
    const editor = createEditor([
      {
        type: 'docParagraph',
        attrs: { docxIndex: 0 },
        content: [
          { type: 'text', text: 'a' },
          { type: 'docNoteRef', attrs: { kind: 'endnote', id: '5', num: 1 } },
          { type: 'docXeMark', attrs: { term: 'glossary term' } },
        ],
      },
    ])
    const para = (editor.getJSON() as PmNode).content![0]
    const types = (para.content ?? []).map((n) => n.type)
    expect(types).toEqual(['text', 'docNoteRef', 'docXeMark'])
    const html = editor.getHTML()
    expect(html).toContain('data-note-ref="5"')
    expect(html).toContain('data-xe-term="glossary term"')
    editor.destroy()
  })
})
