import { columnIndex, columnLabel } from './cell-address'
import type { StructuralOperation } from './workbook-dsl'

/**
 * Rewrites A1-style references in a formula after rows/columns shift, the way
 * Excel does for structural edits: every reference to the shifted region
 * moves (absolute $ markers do NOT pin a reference against inserts/deletes —
 * they only matter for copy/fill), references into a deleted region become
 * #REF!, and ranges that partially overlap a deleted region shrink.
 *
 * Handled: plain refs (B2), absolute markers ($B$2), ranges (B2:D4), sheet
 * prefixes (Sheet1!B2, 'My Sheet'!B2 — only rewritten when the prefix names
 * the sheet the structural op targets), quoted string literals (skipped).
 * Function names like LOG10 are protected by boundary checks.
 */

export interface ShiftSpec {
  readonly axis: 'row' | 'column'
  /** 0-based first affected index */
  readonly start: number
  /** positive for inserts, negative for deletes */
  readonly delta: number
}

export function shiftSpecForOp(op: StructuralOperation): ShiftSpec | null {
  switch (op.op) {
    case 'insert_rows':
      return { axis: 'row', start: op.row - 1, delta: op.count }
    case 'delete_rows':
      return { axis: 'row', start: op.row - 1, delta: -op.count }
    case 'insert_cols':
      return { axis: 'column', start: columnIndex(op.column), delta: op.count }
    case 'delete_cols':
      return { axis: 'column', start: columnIndex(op.column), delta: -op.count }
    case 'add_sheet':
    case 'delete_sheet':
    case 'duplicate_sheet':
    case 'set_sheet_hidden':
    case 'move_sheet':
      return null
  }
}

/** index after the shift, or null when it falls inside a deleted region */
export function shiftIndex(index: number, spec: ShiftSpec): number | null {
  if (index < spec.start) return index
  if (spec.delta > 0) return index + spec.delta
  if (index < spec.start - spec.delta) return null
  return index + spec.delta
}

interface RefPart {
  readonly colAbs: string
  readonly col: number
  readonly rowAbs: string
  readonly row: number
}

function formatRef(part: RefPart): string {
  return `${part.colAbs}${columnLabel(part.col)}${part.rowAbs}${part.row + 1}`
}

function shiftRefPart(part: RefPart, spec: ShiftSpec): RefPart | null {
  const value = spec.axis === 'row' ? part.row : part.col
  const shifted = shiftIndex(value, spec)
  if (shifted === null) return null
  return spec.axis === 'row' ? { ...part, row: shifted } : { ...part, col: shifted }
}

/** clamp a deleted endpoint so a partially-deleted range shrinks instead of erroring */
function clampRefPart(part: RefPart, spec: ShiftSpec, side: 'start' | 'end'): RefPart {
  const clamped = side === 'start' ? spec.start : spec.start - 1
  return spec.axis === 'row' ? { ...part, row: clamped } : { ...part, col: clamped }
}

// sheet prefix (optional) + first ref + optional ":second ref". Boundaries:
// not preceded by [A-Za-z0-9_.$] (protects LOG10, names) and the ref itself
// must not be followed by a letter/digit/( (protects ABC1DEF, functions).
const REF_RE =
  /(?<![A-Za-z0-9_.$!])(?:(?:'([^']+)'|([A-Za-z0-9_.]+))!)?(\$?)([A-Z]{1,3})(\$?)([0-9]{1,7})(?::(\$?)([A-Z]{1,3})(\$?)([0-9]{1,7}))?(?![A-Za-z0-9(])/g

export interface FormulaShiftResult {
  readonly formula: string
  readonly changed: boolean
  readonly hasRefError: boolean
}

/**
 * @param formulaSheetMatchesOp true when the cell holding this formula lives
 *        on the sheet the structural op targets (bare refs are rewritten)
 * @param opSheetName name of the op's target sheet (matches explicit prefixes)
 */
export function shiftFormulaRefs(
  formula: string,
  op: StructuralOperation,
  formulaSheetMatchesOp: boolean,
  opSheetName: string,
): FormulaShiftResult {
  const spec = shiftSpecForOp(op)
  if (!spec) return { formula, changed: false, hasRefError: false }

  let changed = false
  let hasRefError = false

  // Split on string literals so refs inside "..." are never rewritten.
  const segments = formula.split(/("(?:[^"]|"")*")/)
  const rewritten = segments.map((segment, index) => {
    if (index % 2 === 1) return segment
    return segment.replace(
      REF_RE,
      (match, quoted, bare, aAbsC, aCol, aAbsR, aRow, bAbsC, bCol, bAbsR, bRow) => {
        const prefixSheet = (quoted ?? bare) as string | undefined
        const applies =
          prefixSheet === undefined ? formulaSheetMatchesOp : prefixSheet === opSheetName
        if (!applies) return match

        const prefix =
          prefixSheet === undefined ? '' : `${quoted !== undefined ? `'${quoted}'` : bare}!`
        const first: RefPart = {
          colAbs: aAbsC as string,
          col: columnIndex(aCol as string),
          rowAbs: aAbsR as string,
          row: Number(aRow) - 1,
        }
        if (bCol === undefined) {
          const shifted = shiftRefPart(first, spec)
          if (!shifted) {
            changed = true
            hasRefError = true
            return `${prefix}#REF!`
          }
          const next = `${prefix}${formatRef(shifted)}`
          if (next !== match) changed = true
          return next
        }

        const second: RefPart = {
          colAbs: bAbsC as string,
          col: columnIndex(bCol as string),
          rowAbs: bAbsR as string,
          row: Number(bRow) - 1,
        }
        let shiftedFirst = shiftRefPart(first, spec)
        let shiftedSecond = shiftRefPart(second, spec)
        if (!shiftedFirst && !shiftedSecond) {
          changed = true
          hasRefError = true
          return `${prefix}#REF!`
        }
        if (!shiftedFirst) shiftedFirst = clampRefPart(first, spec, 'start')
        if (!shiftedSecond) shiftedSecond = clampRefPart(second, spec, 'end')
        const next = `${prefix}${formatRef(shiftedFirst)}:${formatRef(shiftedSecond)}`
        if (next !== match) changed = true
        return next
      },
    )
  })

  return { formula: rewritten.join(''), changed, hasRefError }
}
