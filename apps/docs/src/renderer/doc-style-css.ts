import type { ParsedDocFull, ThemeColors, ThemeFonts } from '@genoffice/docx-engine'
import { cssFontFamily, cssLineHeight, lineHeightFactor, textHasCjk } from './line-metrics'

/**
 * CSS for the document theme (Design ▸ Themes / Fonts / Colors). Kept separate from
 * docStyleCss so the page reflects a theme pick immediately instead of only after
 * save + reopen in Word: App re-renders this from live state, while
 * docStyleCss is regenerated only on parse.
 */
export function docThemeCss(
  fonts: ThemeFonts | null | undefined,
  colors: ThemeColors | null | undefined,
): string {
  const rules: string[] = []
  if (fonts?.minor) {
    // Body font: the theme's minor latin face (docDefaults still wins for runs that name a font)
    rules.push(`.doc-page { font-family:${cssFontFamily(fonts.minor)} }`)
  }
  if (fonts?.major) {
    const headings = [1, 2, 3, 4, 5, 6].map((n) => `.doc-page h${n}`).join(', ')
    rules.push(`${headings} { font-family:${cssFontFamily(fonts.major)} }`)
  }
  if (colors?.accent1) {
    // Heading color + the accent variable the ribbon's style presets already read
    rules.push(`.doc-page { --theme-accent:#${colors.accent1} }`)
    const headings = [1, 2, 3, 4].map((n) => `.doc-page h${n}`).join(', ')
    rules.push(`${headings} { color:#${colors.accent1} }`)
  }
  return rules.join('\n')
}

/**
 * Per-document CSS generated from styles.xml, so paragraphs render with their
 * style's font size / color / spacing (display-only; the save
 * path never touches styles.xml).
 */
/** Body contains CJK text (drives the document-level line-height factor). */
export function docHasCjk(parsed: ParsedDocFull): boolean {
  return parsed.blocks.some((b) => !b.hidden && (b.runs ?? []).some((r) => textHasCjk(r.text)))
}

/**
 * Document-level line-height factor: bodies containing CJK use the Chinese font's
 * factor (Word takes the max of in-line fonts; the declared eastAsia default font
 * doesn't reflect actual content, and pure-English documents shouldn't get CJK
 * line height). Recomputed live while editing via App's liveDocCjk.
 */
export function docLineFactor(parsed: ParsedDocFull, hasCjk: boolean): number {
  const dd = parsed.docDefaults
  return hasCjk
    ? lineHeightFactor(dd?.eastAsiaFont ?? '宋体')
    : lineHeightFactor(dd?.asciiFont ?? 'Calibri')
}

export function docStyleCss(parsed: ParsedDocFull): string {
  const rules: string[] = []
  const dd = parsed.docDefaults
  {
    const decls: string[] = []
    // Paragraph level also overrides this variable per paragraph's text (blockAttrs
    // at parse time + live decorations in LineFactorExtension).
    const factor = docLineFactor(parsed, docHasCjk(parsed))
    decls.push(`--doc-line-factor:${factor}`)
    decls.push(`font-family:${cssFontFamily(dd?.asciiFont ?? 'Calibri')}`)
    if (dd?.sizeHalfPoints) decls.push(`font-size:${dd.sizeHalfPoints / 2}pt`)
    if (dd?.color) decls.push(`color:#${dd.color}`)
    if (dd?.bold) decls.push('font-weight:600')
    if (dd?.italic) decls.push('font-style:italic')
    const lh = cssLineHeight(dd?.lineRule, dd?.lineRawTwips, dd?.lineSpacing)
    decls.push(`line-height:${lh ?? `calc(${factor} * 1)`}`)
    rules.push(`.doc-page { ${decls.join(';')} }`)
  }
  // table styles: tables carrying data-tbl-style are colored by style (explicit cell shading
  // is inline style and naturally overrides these rules; parse gives exact display after save)
  for (const info of parsed.styles.values()) {
    const t = info.tableDisplay
    if (info.type !== 'table' || !t) continue
    const sel = `.doc-page table[data-tbl-style="${CSS.escape(info.styleId)}"]`
    if (t.fill) rules.push(`${sel} td, ${sel} th { background:#${t.fill} }`)
    if (t.band1Fill) {
      rules.push(`${sel} tr:nth-child(odd):not(:first-child) td { background:#${t.band1Fill} }`)
    }
    if (t.band2Fill) {
      rules.push(`${sel} tr:nth-child(even):not(:first-child) td { background:#${t.band2Fill} }`)
    }
    if (t.firstRow) {
      const decls: string[] = []
      if (t.firstRow.fill) decls.push(`background:#${t.firstRow.fill}`)
      if (t.firstRow.bold) decls.push('font-weight:600')
      if (t.firstRow.color) decls.push(`color:#${t.firstRow.color}`)
      if (decls.length > 0) rules.push(`${sel} tr:first-child td { ${decls.join(';')} }`)
    }
  }
  for (const info of parsed.styles.values()) {
    const d = info.display
    if (!d) continue
    const decls: string[] = []
    if (d.sizeHalfPoints) decls.push(`font-size:${d.sizeHalfPoints / 2}pt`)
    if (d.color) decls.push(`color:#${d.color}`)
    if (d.bold) decls.push('font-weight:600')
    if (d.italic) decls.push('font-style:italic')
    if (d.underline || d.strike) {
      decls.push(
        `text-decoration:${[d.underline && 'underline', d.strike && 'line-through'].filter(Boolean).join(' ')}`,
      )
    }
    if (d.font) decls.push(`font-family:${cssFontFamily(d.font)}`)
    if (d.charSpacingTwips) decls.push(`letter-spacing:${d.charSpacingTwips / 20}pt`)
    const styleLh = cssLineHeight(d.lineRule, d.lineRawTwips, d.lineSpacing)
    if (styleLh) decls.push(`line-height:${styleLh}`)
    if (d.spaceBeforeTwips !== undefined)
      decls.push(`margin-top:${(d.spaceBeforeTwips / 20).toFixed(1)}pt`)
    if (d.spaceAfterTwips !== undefined)
      decls.push(`margin-bottom:${(d.spaceAfterTwips / 20).toFixed(1)}pt`)
    if (d.indentLeftTwips) decls.push(`margin-left:${(d.indentLeftTwips / 20).toFixed(1)}pt`)
    if (d.indentRightTwips) decls.push(`margin-right:${(d.indentRightTwips / 20).toFixed(1)}pt`)
    if (d.indentFirstLineTwips)
      decls.push(`text-indent:${(d.indentFirstLineTwips / 20).toFixed(1)}pt`)
    if (decls.length === 0) continue
    rules.push(`.doc-page [data-style="${CSS.escape(info.styleId)}"] { ${decls.join(';')} }`)
  }
  return rules.join('\n')
}
