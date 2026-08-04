/// Screen ↔ file coordinate mapping for streamed sheets with journaled
/// structural operations. "File" space is the original xlsx the sidecar
/// reads; "screen" space is Univer's post-operation model. Viewport requests
/// translate screen → file, streamed results translate file → screen; rows
/// and columns inserted this session have no file backing (`null`).

import type { StructuralOp } from '../gateway/xlsx-structure'
import type { WorkbookRangeResult } from '../shared/desktop-api'

export type Axis = 'row' | 'column'

interface CellArea {
  readonly startRow: number
  readonly endRow: number
  readonly startColumn: number
  readonly endColumn: number
}

type RowColumnOp = Extract<StructuralOp, { index: number }>

function axisOf(op: RowColumnOp): Axis {
  return op.kind === 'insert-rows' || op.kind === 'remove-rows' ? 'row' : 'column'
}

function isInsert(op: RowColumnOp): boolean {
  return op.kind === 'insert-rows' || op.kind === 'insert-cols'
}

function rowColumnOps(ops: readonly StructuralOp[], axis: Axis): RowColumnOp[] {
  return ops.filter((op): op is RowColumnOp => 'index' in op && axisOf(op) === axis)
}

/// Where a file line sits on screen after all operations, or null when a
/// removal deleted it.
export function fileToScreen(
  ops: readonly StructuralOp[],
  axis: Axis,
  index: number,
): number | null {
  let position = index
  for (const op of rowColumnOps(ops, axis)) {
    if (isInsert(op)) {
      if (position >= op.index) position += op.count
    } else {
      if (position >= op.index && position < op.index + op.count) return null
      if (position >= op.index + op.count) position -= op.count
    }
  }
  return position
}

/// Which file line backs a screen position, or null when the line was
/// inserted this session (journal-owned, nothing to stream).
export function screenToFile(
  ops: readonly StructuralOp[],
  axis: Axis,
  index: number,
): number | null {
  let position = index
  const relevant = rowColumnOps(ops, axis)
  for (let step = relevant.length - 1; step >= 0; step -= 1) {
    const op = relevant[step]
    if (!op) continue
    if (isInsert(op)) {
      if (position >= op.index && position < op.index + op.count) return null
      if (position >= op.index + op.count) position -= op.count
    } else if (position >= op.index) {
      position += op.count
    }
  }
  return position
}

/// Net size change of an axis: screen extent = file extent + delta.
export function netAxisDelta(ops: readonly StructuralOp[], axis: Axis): number {
  let delta = 0
  for (const op of rowColumnOps(ops, axis)) {
    delta += isInsert(op) ? op.count : -op.count
  }
  return delta
}

function axisSpanToFile(
  ops: readonly StructuralOp[],
  axis: Axis,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let fileStart: number | null = null
  for (let index = start; index <= end && fileStart === null; index += 1) {
    fileStart = screenToFile(ops, axis, index)
  }
  if (fileStart === null) return null
  let fileEnd: number | null = null
  for (let index = end; index >= start && fileEnd === null; index -= 1) {
    fileEnd = screenToFile(ops, axis, index)
  }
  if (fileEnd === null || fileEnd < fileStart) return null
  return { start: fileStart, end: fileEnd }
}

/// File-space range backing a screen-space range. The result may span file
/// lines that were deleted (they map back to nothing and are dropped on
/// install). Null when no line in the range has file backing.
export function screenRangeToFileRange(
  ops: readonly StructuralOp[],
  range: CellArea,
): CellArea | null {
  const rows = axisSpanToFile(ops, 'row', range.startRow, range.endRow)
  const columns = axisSpanToFile(ops, 'column', range.startColumn, range.endColumn)
  if (!rows || !columns) return null
  return {
    startRow: rows.start,
    endRow: rows.end,
    startColumn: columns.start,
    endColumn: columns.end,
  }
}

function axisSpanToScreen(
  ops: readonly StructuralOp[],
  axis: Axis,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let screenStart: number | null = null
  for (let index = start; index <= end && screenStart === null; index += 1) {
    screenStart = fileToScreen(ops, axis, index)
  }
  if (screenStart === null) return null
  let screenEnd: number | null = null
  for (let index = end; index >= start && screenEnd === null; index -= 1) {
    screenEnd = fileToScreen(ops, axis, index)
  }
  if (screenEnd === null || screenEnd < screenStart) return null
  return { start: screenStart, end: screenEnd }
}

/// Screen-space extent of a file-space range; null when every line in the
/// range was deleted.
export function fileRangeToScreenRange(
  ops: readonly StructuralOp[],
  range: CellArea,
): CellArea | null {
  const rows = axisSpanToScreen(ops, 'row', range.startRow, range.endRow)
  const columns = axisSpanToScreen(ops, 'column', range.startColumn, range.endColumn)
  if (!rows || !columns) return null
  return {
    startRow: rows.start,
    endRow: rows.end,
    startColumn: columns.start,
    endColumn: columns.end,
  }
}

/// Screen position of the indexing cutoff: the last screen row whose file
/// row is indexed. Screen rows above it are either indexed or inserted.
export function indexedThroughScreenRow(
  ops: readonly StructuralOp[],
  indexedThroughFileRow: number | null,
): number | null {
  if (indexedThroughFileRow === null) return null
  for (let fileRow = indexedThroughFileRow; fileRow >= 0; fileRow -= 1) {
    const screenRow = fileToScreen(ops, 'row', fileRow)
    if (screenRow !== null) return screenRow
  }
  return -1
}

/// Translates a sidecar range result (file coordinates) into screen
/// coordinates. Cells, row properties, and hyperlinks on deleted lines are
/// dropped; merges with a deleted edge are skipped (display-only loss —
/// the save side reshapes merges through the same operation stream).
export function mapRangeResultToScreen(
  ops: readonly StructuralOp[],
  result: WorkbookRangeResult,
): Pick<WorkbookRangeResult, 'cells' | 'rows' | 'merges' | 'hyperlinks'> {
  const cells: WorkbookRangeResult['cells'] = []
  for (const cell of result.cells) {
    const row = fileToScreen(ops, 'row', cell.row)
    const column = fileToScreen(ops, 'column', cell.column)
    if (row === null || column === null) continue
    cells.push({ ...cell, row, column })
  }
  const rows: WorkbookRangeResult['rows'] = []
  for (const rowProperty of result.rows) {
    const row = fileToScreen(ops, 'row', rowProperty.row)
    if (row === null) continue
    rows.push({ ...rowProperty, row })
  }
  const merges: WorkbookRangeResult['merges'] = []
  for (const merge of result.merges) {
    const startRow = fileToScreen(ops, 'row', merge.startRow)
    const endRow = fileToScreen(ops, 'row', merge.endRow)
    const startColumn = fileToScreen(ops, 'column', merge.startColumn)
    const endColumn = fileToScreen(ops, 'column', merge.endColumn)
    if (startRow === null || endRow === null || startColumn === null || endColumn === null) continue
    merges.push({ startRow, endRow, startColumn, endColumn })
  }
  const hyperlinks: WorkbookRangeResult['hyperlinks'] = []
  for (const hyperlink of result.hyperlinks) {
    const row = fileToScreen(ops, 'row', hyperlink.row)
    const column = fileToScreen(ops, 'column', hyperlink.column)
    if (row === null || column === null) continue
    hyperlinks.push({ ...hyperlink, row, column })
  }
  return { cells, rows, merges, hyperlinks }
}
