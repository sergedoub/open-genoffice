import { Editor } from '@tiptap/core'
import { parseDocx, saveDocx } from '@genoffice/docx-engine'
import { describe, expect, it } from 'vitest'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { blocksToPmDoc, pmDocToSavePlan, type PmNode } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'

const STYLE =
  '<w:style w:type="table" w:styleId="GridBlue"><w:name w:val="Grid Blue"/>' +
  '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr>' +
  '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="4472C4"/></w:tcPr></w:tblStylePr>' +
  '</w:style>'

const TABLE =
  '<w:tbl><w:tblPr><w:tblStyle w:val="GridBlue"/><w:tblLook w:firstRow="1"/></w:tblPr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:tc></w:tr>' +
  '</w:tbl>'

describe('table styles in the editor', () => {
  it('renders style-derived header fill and stays byte-identical untouched', async () => {
    const source = await buildDocx({ bodyXml: TABLE, extraStylesXml: STYLE })
    const parsed = await parseDocx(source)
    expect(parsed.blocks[0].table!.rows[0][0].fill).toBe('4472C4')

    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: blocksToPmDoc(parsed.blocks) as never,
    })
    const headerCell = editor.view.dom.querySelector('table.doc-table th, table.doc-table td')
    expect((headerCell as HTMLElement | null)?.style.background).toContain('rgb(68, 114, 196)')

    const plan = pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks)
    expect(plan.changedCount).toBe(0)
    expect(await saveDocx(parsed, plan.saveBlocks)).toEqual(source)
    editor.destroy()
  })
})
