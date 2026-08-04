import { numberFormatLabel } from './selection-format'

/// Excel's Number-group category dropdown: label → representative pattern.
export const NUMBER_FORMAT_CATEGORIES: ReadonlyArray<{
  readonly label: string
  readonly pattern: string
}> = [
  { label: 'General', pattern: 'General' },
  { label: 'Number', pattern: '0.00' },
  { label: 'Currency', pattern: '$#,##0.00' },
  { label: 'Accounting', pattern: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)' },
  { label: 'Short Date', pattern: 'm/d/yyyy' },
  { label: 'Long Date', pattern: 'dddd, mmmm dd, yyyy' },
  { label: 'Time', pattern: 'h:mm:ss AM/PM' },
  { label: 'Percentage', pattern: '0.00%' },
  { label: 'Fraction', pattern: '# ?/?' },
  { label: 'Scientific', pattern: '0.00E+00' },
  { label: 'Text', pattern: '@' },
]

/// The dropdown echo for the current selection. The generic 'Date' category
/// splits into Short/Long by whether the pattern spells out day or month names.
export function categoryOptionForPattern(pattern: string): string {
  const label = numberFormatLabel(pattern)
  if (label !== 'Date') return label
  return /dddd|mmmm/i.test(pattern) ? 'Long Date' : 'Short Date'
}
