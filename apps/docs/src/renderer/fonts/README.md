# Metric-compatible fallback fonts

Source: fonts bundled with LibreOffice (`/Applications/LibreOffice.app/Contents/Resources/fonts/truetype`),
freely redistributable with the app. Licenses: Carlito and Liberation are
**SIL Open Font License 1.1** (see `LICENSE-OFL.txt`); Caladea is
**Apache License 2.0** (copyright Huerta Tipografica).

| Font             | License    | Metric-compatible Word counterpart |
| ---------------- | ---------- | ---------------------------------- |
| Carlito          | OFL 1.1    | Calibri (Word's default body font) |
| Caladea          | Apache-2.0 | Cambria                            |
| Liberation Serif | OFL 1.1    | Times New Roman                    |
| Liberation Sans  | OFL 1.1    | Arial                              |
| Liberation Mono  | OFL 1.1    | Courier New                        |

Purpose: when a Word font declared by the document is missing on this machine, the
browser's silent fallback (Helvetica etc.) changes glyph widths, so line-break points
and pagination diverge from Word. Falling back to a metric-compatible font keeps
canvas line breaking aligned with Word, and stays consistent with the offline
pagination model (`tests/helpers/lo-fonts.ts` measures the same set of files).

Registration lives in `fonts.css`; family-name mapping in `cssFontFamily()` of `line-metrics.ts`.

## CJK fallback

| Font                                    | Role                                       |
| --------------------------------------- | ------------------------------------------ |
| Noto Sans CJK SC (GB2312-subset woff2)  | fallback for heiti-style (sans) families   |
| Noto Serif CJK SC (GB2312-subset woff2) | fallback for songti-style (serif) families |

Source: [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk) (SIL OFL 1.1),
subset with fonttools to all 7,445 GB2312 Han characters + CJK punctuation/fullwidth
forms + basic Latin
(`pyftsubset --text-file=gb2312 --unicodes="U+0020-024F,U+2000-206F,U+3000-303F,U+FF00-FFEF" --flavor=woff2`).
Rare characters outside the subset still fall through to system fonts (shown as
missing glyphs in minimal environments); bold is synthesized by the browser.
