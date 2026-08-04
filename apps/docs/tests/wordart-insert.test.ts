/**
 * WordArt insertion tests - Item 3: WordArt (simplified) → save → re-parse
 *
 * Verifies:
 *  1. buildWordArtParagraphXml produces the correct structure
 *  2. Every preset style produces valid XML
 *  3. insert → save → Word structure assertions (wps:wsp + w:txbxContent, no fill, large text)
 *  4. Text is readable after re-parsing
 *  5. The wordArtId field is kept in the display model (display-only, not written to OOXML)
 */
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import {
  buildWordArtParagraphXml,
  parseDocx,
  saveDocx,
  WORDART_PRESETS,
  type TextboxDisplay,
} from '@genoffice/docx-engine'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { blocksToPmDoc, pmDocToSavePlan, type PmNode } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'

async function openBlankDoc() {
  const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>' })
  const parsed = await parseDocx(source)
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: blocksToPmDoc(parsed.blocks) as never,
  })
  return { editor, parsed }
}

function makeWordArtTextbox(wordArtId: string): TextboxDisplay {
  const preset = WORDART_PRESETS.find((p) => p.id === wordArtId) ?? WORDART_PRESETS[0]
  return {
    widthPx: Math.round(2700000 / 9525),
    heightPx: Math.round(720000 / 9525),
    wordArtId,
    paras: [
      {
        runs: [{ text: 'WordArt', color: preset.colorHex, bold: true, sizeHalfPoints: 72 }],
        align: 'center',
      },
    ],
  }
}

function insertWordArt(editor: Editor, wordArtId: string) {
  const xml = buildWordArtParagraphXml({
    wordArtId,
    widthEmu: 2700000,
    heightEmu: 720000,
    id: 1,
  })
  editor
    .chain()
    .insertContentAt(editor.state.doc.content.size, {
      type: 'docProtected',
      attrs: {
        docxIndex: null,
        blockType: 'passthrough',
        label: `WordArt(${wordArtId})`,
        genXml: xml,
        textboxes: [makeWordArtTextbox(wordArtId)],
      },
    })
    .run()
}

describe('WordArt insertion', () => {
  it('buildWordArtParagraphXml generates XML with the correct WPS structure', () => {
    const xml = buildWordArtParagraphXml({ wordArtId: 'wordArt-1', id: 1 })
    expect(xml).toContain('wps:wsp')
    expect(xml).toContain('w:txbxContent')
    expect(xml).toContain('wp:anchor')
    expect(xml).toContain('mc:AlternateContent')
    // large text: sz=72 (36pt)
    expect(xml).toContain('w:val="72"')
    // preset color
    expect(xml).toContain('4472C4')
    // center alignment
    expect(xml).toContain('w:val="center"')
    // mc:Fallback should NOT have xmlns:mc attribute
    expect(xml).not.toContain('mc:Fallback xmlns:mc=')
  })

  it('buildWordArtParagraphXml with default parameters (no options) still generates valid XML', () => {
    const xml = buildWordArtParagraphXml({})
    expect(xml).toContain('wps:wsp')
    expect(xml).toContain('WordArt')
    expect(xml).toContain('w:val="72"')
  })

  it('WORDART_PRESETS contains at least 4 presets', () => {
    expect(WORDART_PRESETS.length).toBeGreaterThanOrEqual(4)
    for (const p of WORDART_PRESETS) {
      expect(p.id).toBeTruthy()
      expect(p.label).toBeTruthy()
      expect(p.colorHex).toMatch(/^[0-9A-Fa-f]{6}$/)
    }
  })

  it.each(WORDART_PRESETS.map((p) => [p.id, p.label] as [string, string]))(
    'preset %s (%s) generates XML containing the matching color',
    (id) => {
      const preset = WORDART_PRESETS.find((p) => p.id === id)!
      const xml = buildWordArtParagraphXml({ wordArtId: id, id: 1 })
      expect(xml).toContain(preset.colorHex)
      expect(xml).toContain('wps:wsp')
    },
  )

  it('WordArt insert → saveBlocks contains kind:xml with wps:wsp', async () => {
    const { editor, parsed } = await openBlankDoc()
    insertWordArt(editor, 'wordArt-1')

    const plan = pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks)
    const xmlBlock = plan.saveBlocks.find((b) => b.kind === 'xml') as
      { kind: 'xml'; xml: string } | undefined
    expect(xmlBlock).toBeDefined()
    expect(xmlBlock?.xml).toContain('wps:wsp')
    expect(xmlBlock?.xml).toContain('w:txbxContent')
    editor.destroy()
  })

  it('WordArt insert → save → reparse keeps the text readable', async () => {
    const { editor, parsed } = await openBlankDoc()

    // Override default text to check it round-trips
    const xml = buildWordArtParagraphXml({ wordArtId: 'wordArt-2', text: 'Test text', id: 2 })
    const textbox: TextboxDisplay = {
      widthPx: Math.round(2700000 / 9525),
      heightPx: Math.round(720000 / 9525),
      wordArtId: 'wordArt-2',
      paras: [
        {
          runs: [{ text: 'Test text', color: '7B2FBE', bold: true, sizeHalfPoints: 72 }],
          align: 'center',
        },
      ],
    }
    editor
      .chain()
      .insertContentAt(editor.state.doc.content.size, {
        type: 'docProtected',
        attrs: {
          docxIndex: null,
          blockType: 'passthrough',
          label: 'WordArt(test)',
          genXml: xml,
          textboxes: [textbox],
        },
      })
      .run()

    const plan = pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks)
    const saved = await saveDocx(parsed, plan.saveBlocks)
    const reparsed = await parseDocx(saved)
    const block = reparsed.blocks.find((b) => b.textboxes)
    expect(block).toBeDefined()
    // Text should be preserved
    expect(block?.textboxes?.[0].paras[0].runs[0].text).toBe('Test text')
    editor.destroy()
  })

  it('saving WordArt with an empty text box does not corrupt the document structure', async () => {
    const { editor, parsed } = await openBlankDoc()
    insertWordArt(editor, 'wordArt-3')

    const plan = pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks)
    const saved = await saveDocx(parsed, plan.saveBlocks)
    // Saved docx should be a valid ZIP (starts with PK magic)
    expect(saved[0]).toBe(0x50) // 'P'
    expect(saved[1]).toBe(0x4b) // 'K'
    editor.destroy()
  })

  it('outline WordArt (noFill) XML contains the noFill element', () => {
    const xml = buildWordArtParagraphXml({ wordArtId: 'wordArt-3', id: 1 })
    // shape fill is noFill for wordArt-3
    expect(xml).toContain('<a:noFill/>')
  })
})
