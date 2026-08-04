/**
 * Run-level format fidelity: latin/ea dual fonts kept + underline style not collapsed.
 * Modeled via parseSlide (with latinFont/eaFont/fontImplicit/underlineStyle markers),
 * then asserted at the byte level through patchTextElementXml.
 */
import { describe, it, expect } from 'vitest'
import { parseSlide } from '../src/parse'
import { patchTextElementXml, setElementFont } from '../src/index'
import type { TextElement } from '../src/types'

const slideWith = (sp: string) =>
  '<?xml version="1.0"?><p:sld xmlns:p="p" xmlns:a="a"><p:cSld>' +
  `<p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${sp}</p:spTree></p:cSld></p:sld>`
const spWith = (runs: string) =>
  '<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>' +
  `<p:txBody><a:bodyPr/><a:p>${runs}</a:p></p:txBody></p:sp>`

const parseEl = (runs: string) => {
  const slide = parseSlide({
    path: 'ppt/slides/slide1.xml',
    slideXml: slideWith(spWith(runs)),
    ctx: {},
  })
  return { slide, el: slide.elements[0] as TextElement }
}

describe('latin/ea dual fonts preserved', () => {
  const DUAL =
    '<a:r><a:rPr lang="en" sz="1800"><a:latin typeface="Calibri"/><a:ea typeface="微软雅黑"/></a:rPr><a:t>混排 text</a:t></a:r>'

  it('parses latinFont/eaFont verbatim', () => {
    const { el } = parseEl(DUAL)
    const r = el.text!.paragraphs[0]!.runs[0]!
    expect(r.latinFont).toBe('Calibri')
    expect(r.eaFont).toBe('微软雅黑')
    expect(r.fontImplicit).toBeUndefined()
  })

  it('text-only edit: dual font declarations keep their original bytes', () => {
    const { el } = parseEl(DUAL)
    el.text!.paragraphs[0]!.runs[0]!.text = 'edited 编辑'
    const out = patchTextElementXml(el, el.anchor.originalXml)
    expect(out).toContain('<a:latin typeface="Calibri"/>')
    expect(out).toContain('<a:ea typeface="微软雅黑"/>')
    expect(out).toContain('edited 编辑')
  })

  it('theme font reference (+mn-lt) not materialized when the font is unchanged', () => {
    const { el } = parseEl('<a:r><a:rPr><a:latin typeface="+mn-lt"/></a:rPr><a:t>x</a:t></a:r>')
    el.text!.paragraphs[0]!.runs[0]!.text = 'y'
    const out = patchTextElementXml(el, el.anchor.originalXml)
    expect(out).toContain('typeface="+mn-lt"')
  })

  it('run without font declaration (inherited): text-only edit does not inject latin/ea', () => {
    const { el } = parseEl('<a:r><a:rPr sz="1800"/><a:t>x</a:t></a:r>')
    expect(el.text!.paragraphs[0]!.runs[0]!.fontImplicit).toBe(true)
    el.text!.paragraphs[0]!.runs[0]!.text = 'y'
    const out = patchTextElementXml(el, el.anchor.originalXml)
    expect(out).not.toContain('<a:latin')
  })

  it('setElementFont explicit font change: both latin/ea rewritten to the new font', () => {
    const { slide, el } = parseEl(DUAL)
    setElementFont(slide, el.id, { fontFamily: 'Arial' })
    const out = patchTextElementXml(el, el.anchor.originalXml)
    expect(out).toContain('<a:latin typeface="Arial"/>')
    expect(out).toContain('<a:ea typeface="Arial"/>')
    expect(out).not.toContain('微软雅黑')
  })
})

describe('underline style not collapsed', () => {
  it('u="dbl" stays dbl after a text-only edit', () => {
    const { el } = parseEl('<a:r><a:rPr u="dbl"/><a:t>x</a:t></a:r>')
    const r = el.text!.paragraphs[0]!.runs[0]!
    expect(r.underline).toBe(true)
    expect(r.underlineStyle).toBe('dbl')
    r.text = 'y'
    const out = patchTextElementXml(el, el.anchor.originalXml)
    expect(out).toContain('u="dbl"')
    expect(out).not.toContain('u="sng"')
  })

  it('removing underline: existing u becomes none; runs without u get nothing injected', () => {
    const { el } = parseEl(
      '<a:r><a:rPr u="wavy"/><a:t>a</a:t></a:r><a:r><a:rPr/><a:t>b</a:t></a:r>',
    )
    const [r1, r2] = el.text!.paragraphs[0]!.runs
    r1!.underline = false
    delete r1!.underlineStyle
    r2!.text = 'b2'
    const out = patchTextElementXml(el, el.anchor.originalXml)
    expect(out).toContain('u="none"')
    expect(out).not.toContain('u="wavy"')
    // The second run had no u originally; do not inject one
    expect(out.match(/\su="/g)!.length).toBe(1)
  })

  it('newly enabled underline writes sng', () => {
    const { el } = parseEl('<a:r><a:rPr/><a:t>x</a:t></a:r>')
    el.text!.paragraphs[0]!.runs[0]!.underline = true
    const out = patchTextElementXml(el, el.anchor.originalXml)
    expect(out).toContain('u="sng"')
  })
})
