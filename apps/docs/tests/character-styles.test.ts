import { Editor } from '@tiptap/core'
import { parseDocx, saveDocx } from '@genoffice/docx-engine'
import { describe, expect, it } from 'vitest'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { blocksToPmDoc, pmDocToSavePlan, type PmNode } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'

const STYLES =
  '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/>' +
  '<w:rPr><w:i/><w:color w:val="C00000"/></w:rPr></w:style>'

const BODY =
  '<w:p><w:r><w:t xml:space="preserve">before</w:t></w:r>' +
  '<w:r><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>emphasized</w:t></w:r>' +
  '<w:r><w:t>after</w:t></w:r></w:p>'

async function open() {
  const source = await buildDocx({ bodyXml: BODY, extraStylesXml: STYLES })
  const parsed = await parseDocx(source)
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: blocksToPmDoc(parsed.blocks) as never,
  })
  return { editor, parsed, source }
}

describe('character styles in the editor', () => {
  it('renders rStyle runs as data-style spans', async () => {
    const { editor } = await open()
    const span = editor.view.dom.querySelector('span[data-style="Emphasis"]')
    expect(span?.textContent).toBe('emphasized')
    editor.destroy()
  })

  it('keeps an untouched document with character styles byte-identical', async () => {
    const { editor, parsed, source } = await open()
    const plan = pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks)
    expect(plan.changedCount).toBe(0)
    expect(await saveDocx(parsed, plan.saveBlocks)).toEqual(source)
    editor.destroy()
  })

  it('preserves rStyle when the paragraph is edited', async () => {
    const { editor, parsed } = await open()
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'extra')
    const plan = pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks)
    expect(plan.changedCount).toBe(1)
    const bytes = await saveDocx(parsed, plan.saveBlocks)
    const reparsed = await parseDocx(bytes)
    const styled = reparsed.blocks[0].runs!.find((r) => r.styleId === 'Emphasis')
    expect(styled?.text).toBe('emphasized')
    editor.destroy()
  })
})
