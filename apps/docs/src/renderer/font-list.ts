import type { Lang } from '@genoffice/i18n'

/**
 * Font dropdown candidates grouped by script, ordered per UI language so the
 * fonts a user is most likely to want appear at the top (e.g. Western fonts
 * for the US market, Japanese fonts for the Japanese market).
 */
const LATIN = [
  'Calibri',
  'Arial',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Tahoma',
  'Cambria',
  'Garamond',
  'Trebuchet MS',
  'Segoe UI',
  'Courier New',
  'Impact',
]
// GB/T 9704 official-document fonts included so government documents can be
// authored from scratch (values are free-typed either way; the combobox accepts any name)
const SIMPLIFIED_CHINESE = [
  '等线',
  '宋体',
  '黑体',
  '微软雅黑',
  '楷体',
  '仿宋',
  '仿宋_GB2312',
  '楷体_GB2312',
  '方正小标宋简体',
]
const JAPANESE = ['Yu Gothic', 'Yu Mincho', 'Meiryo', 'MS Gothic', 'MS Mincho']
const KOREAN = ['Malgun Gothic', 'Batang', 'Gulim', 'Dotum']
const TRADITIONAL_CHINESE = ['Microsoft JhengHei', 'PMingLiU']

export function fontFamiliesFor(lang: Lang): readonly string[] {
  switch (lang) {
    case 'zh':
      return [...SIMPLIFIED_CHINESE, ...LATIN, ...JAPANESE, ...KOREAN, ...TRADITIONAL_CHINESE]
    case 'zh-TW':
      return [...TRADITIONAL_CHINESE, ...LATIN, ...SIMPLIFIED_CHINESE, ...JAPANESE, ...KOREAN]
    case 'ja':
      return [...JAPANESE, ...LATIN, ...SIMPLIFIED_CHINESE, ...KOREAN, ...TRADITIONAL_CHINESE]
    case 'ko':
      return [...KOREAN, ...LATIN, ...JAPANESE, ...SIMPLIFIED_CHINESE, ...TRADITIONAL_CHINESE]
    default:
      return [...LATIN, ...JAPANESE, ...SIMPLIFIED_CHINESE, ...KOREAN, ...TRADITIONAL_CHINESE]
  }
}

/**
 * docDefaults w:eastAsia font for new blank documents, matching what Word
 * ships per market (zh → SimSun, ja → Yu Mincho, ko → Malgun Gothic,
 * zh-TW → PMingLiU). English and every other language return undefined —
 * like en-US Word, whose theme leaves the East Asian slot empty and lets
 * per-script substitution kick in only when CJK text actually appears.
 * Latin default stays Calibri for every language.
 */
export function defaultEastAsiaFontFor(lang: Lang): string | undefined {
  switch (lang) {
    case 'zh':
      return '宋体'
    case 'ja':
      return 'Yu Mincho'
    case 'ko':
      return 'Malgun Gothic'
    case 'zh-TW':
      return 'PMingLiU'
    default:
      return undefined
  }
}
