import { describe, expect, it } from 'vitest'

import type { StructuralOp } from '../src/gateway/xlsx-structure'
import {
  fileToScreen,
  indexedThroughScreenRow,
  mapRangeResultToScreen,
  netAxisDelta,
  screenRangeToFileRange,
  screenToFile,
} from '../src/renderer/view-transform'

const insertRows = (index: number, count = 1): StructuralOp =>
  ({ kind: 'insert-rows', index, count })
const removeRows = (index: number, count = 1): StructuralOp =>
  ({ kind: 'remove-rows', index, count })
const insertCols = (index: number, count = 1): StructuralOp =>
  ({ kind: 'insert-cols', index, count })
const merge = (): StructuralOp =>
  ({ kind: 'merge-cells', range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } })

describe('fileToScreen / screenToFile', () => {
  it('shifts positions across inserts and removals and stays inverse-consistent', () => {
    const ops = [insertRows(5, 2), removeRows(10, 1), insertCols(2, 3)]
    // File row 4 is untouched; file row 5 moved down by the insert.
    expect(fileToScreen(ops, 'row', 4)).toBe(4)
    expect(fileToScreen(ops, 'row', 5)).toBe(7)
    // Screen rows 5-6 are the inserted lines — no file backing.
    expect(screenToFile(ops, 'row', 5)).toBeNull()
    expect(screenToFile(ops, 'row', 6)).toBeNull()
    expect(screenToFile(ops, 'row', 7)).toBe(5)
    // The removal happened at post-insert screen index 10 = file row 8.
    expect(fileToScreen(ops, 'row', 8)).toBeNull()
    expect(fileToScreen(ops, 'row', 9)).toBe(10)
    expect(screenToFile(ops, 'row', 10)).toBe(9)
    // Columns shift independently.
    expect(fileToScreen(ops, 'column', 1)).toBe(1)
    expect(fileToScreen(ops, 'column', 2)).toBe(5)
    expect(screenToFile(ops, 'column', 3)).toBeNull()
    // Round trip over surviving lines.
    for (let file = 0; file < 30; file += 1) {
      const screen = fileToScreen(ops, 'row', file)
      if (screen !== null) expect(screenToFile(ops, 'row', screen)).toBe(file)
    }
  })

  it('ignores merge operations and reports net axis deltas', () => {
    const ops = [merge(), insertRows(0, 4), removeRows(2, 1), merge()]
    expect(fileToScreen(ops, 'row', 0)).toBe(3)
    expect(netAxisDelta(ops, 'row')).toBe(3)
    expect(netAxisDelta(ops, 'column')).toBe(0)
  })
})

describe('screenRangeToFileRange', () => {
  const range = (startRow: number, endRow: number, startColumn = 0, endColumn = 5) =>
    ({ startRow, endRow, startColumn, endColumn })

  it('translates a viewport past an insert back to file rows', () => {
    const ops = [insertRows(5, 2)]
    expect(screenRangeToFileRange(ops, range(10, 20))).toEqual(range(8, 18))
  })

  it('skips inserted screen lines at the edges of the request', () => {
    const ops = [insertRows(10, 3)]
    // Screen 10-12 are inserted; only screen 13-15 have file backing.
    expect(screenRangeToFileRange(ops, range(10, 15))).toEqual(range(10, 12))
  })

  it('returns null when the whole range is journal-owned', () => {
    const ops = [insertRows(0, 50)]
    expect(screenRangeToFileRange(ops, range(0, 49))).toBeNull()
  })

  it('spans deleted file rows so the request stays contiguous', () => {
    const ops = [removeRows(10, 5)]
    expect(screenRangeToFileRange(ops, range(8, 12))).toEqual(range(8, 17))
  })
})

describe('mapRangeResultToScreen', () => {
  it('shifts cells and drops content on deleted lines', () => {
    const ops = [removeRows(1, 1), insertCols(0, 1)]
    const mapped = mapRangeResultToScreen(ops, {
      cells: [
        { row: 0, column: 0, value: 'keep' },
        { row: 1, column: 0, value: 'deleted row' },
        { row: 2, column: 1, value: 'shifted' },
      ],
      rows: [{ row: 1, hidden: true }, { row: 2, height: 30, hidden: false }],
      merges: [
        { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
        { startRow: 2, endRow: 3, startColumn: 0, endColumn: 0 },
      ],
      hyperlinks: [{ row: 2, column: 0, target: 'https://example.com' }],
      conditionalRules: [],
      autoFilter: null,
      dataValidations: [],
      sheetProtection: null,
      indexedThroughRow: null,
      indexingComplete: true,
    })
    expect(mapped.cells).toEqual([
      { row: 0, column: 1, value: 'keep' },
      { row: 1, column: 2, value: 'shifted' },
    ])
    expect(mapped.rows).toEqual([{ row: 1, height: 30, hidden: false }])
    // First merge touches the deleted row → skipped; second shifts.
    expect(mapped.merges).toEqual([{ startRow: 1, endRow: 2, startColumn: 1, endColumn: 1 }])
    expect(mapped.hyperlinks).toEqual([{ row: 1, column: 1, target: 'https://example.com' }])
  })
})

describe('indexedThroughScreenRow', () => {
  it('maps the cutoff through shifts and deleted rows', () => {
    expect(indexedThroughScreenRow([insertRows(0, 2)], 10)).toBe(12)
    // File rows 8-10 deleted: the cutoff falls back to file row 7 → screen 7.
    expect(indexedThroughScreenRow([removeRows(8, 3)], 10)).toBe(7)
    expect(indexedThroughScreenRow([], null)).toBeNull()
    // Everything up to the cutoff was deleted.
    expect(indexedThroughScreenRow([removeRows(0, 20)], 10)).toBe(-1)
  })
})
