import { Editor } from '@tiptap/core'
import { parseDocx, saveDocx } from '@genoffice/docx-engine'
import { describe, expect, it } from 'vitest'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { blocksToPmDoc, pmDocToSavePlan, type PmNode } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'

const TOC =
  '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>' +
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText> TOC \\o "1-3" \\h </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  '<w:hyperlink w:anchor="_Toc1"><w:r><w:t>Old title</w:t></w:r>' +
  '<w:r><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText> PAGEREF _Toc1 \\h </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink></w:p>'

const FORMULA =
  '<w:p><m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num>' +
  '<m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath></w:p>'

describe('protected field and formula editing', () => {
  it('double-click edits visible text and round-trips through targeted XML patches', async () => {
    const source = await buildDocx({ bodyXml: TOC + FORMULA })
    const parsed = await parseDocx(source)
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: blocksToPmDoc(parsed.blocks) as never,
    })

    const field = editor.view.dom.querySelector('.doc-protected-field') as HTMLElement
    const title = field.querySelector('.doc-toc-title') as HTMLElement
    const page = field.querySelector('.doc-toc-page') as HTMLElement
    expect(title.getAttribute('contenteditable')).toBe('false')
    title.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    expect(field.draggable).toBe(false)
    title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }))
    expect(title.getAttribute('contenteditable')).toBe('true')
    title.textContent = 'New & title'
    page.textContent = '12'
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))

    const formula = editor.view.dom.querySelector('.doc-protected-formula') as HTMLElement
    const tokens = Array.from(formula.querySelectorAll<HTMLElement>('.doc-formula-token'))
    expect(formula.draggable).toBe(true)
    tokens[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }))
    expect(tokens[0].getAttribute('contenteditable')).toBe('true')
    tokens[0].textContent = 'x'
    tokens[1].textContent = 'y + 1'
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))

    const plan = pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks)
    expect(plan.changedCount).toBe(2)
    const reparsed = await parseDocx(await saveDocx(parsed, plan.saveBlocks))
    expect(reparsed.blocks[0].fieldDisplay).toMatchObject({
      left: 'New & title',
      right: '12',
    })
    expect(reparsed.blocks[1].formulaDisplay?.tokens).toEqual(['x', 'y + 1'])
    expect(reparsed.blocks[0].originalXml).toContain(' TOC \\o "1-3" \\h ')
    expect(reparsed.blocks[1].originalXml).toContain('<m:f><m:num>')
    editor.destroy()
  })

  it('keeps untouched field and formula blocks byte-stable', async () => {
    const source = await buildDocx({ bodyXml: TOC + FORMULA })
    const parsed = await parseDocx(source)
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: blocksToPmDoc(parsed.blocks) as never,
    })
    const plan = pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks)
    expect(plan.changedCount).toBe(0)
    const saved = await saveDocx(parsed, plan.saveBlocks)
    expect(saved).toEqual(source)
    editor.destroy()
  })
})
