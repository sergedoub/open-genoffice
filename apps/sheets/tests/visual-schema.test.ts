import { describe, expect, it } from 'vitest'

import { workbookFileSchema } from '../src/shared/desktop-api'

// The open path parses the sidecar's visuals with this strict schema; a Rust
// output field that zod does not know about rejects the whole workbook
// (docs/dev-usage-notes.md's six-point protocol sync). This guards the
// drawingPath/drawingIndex locator added for save-side visual edits.
const visualSchema = workbookFileSchema.shape.visuals.element

const anchor = {
  fromRow: 0,
  fromColumn: 0,
  toRow: 5,
  toColumn: 3,
  fromRowOffset: 0,
  fromColumnOffset: 9525,
  toRowOffset: -9525,
  toColumnOffset: 0,
}

describe('visual object schema', () => {
  it('accepts the sidecar drawing locator fields', () => {
    const parsed = visualSchema.parse({
      id: 'visual-1',
      sheetId: 'sheet-1',
      kind: 'shape',
      anchor,
      shapeType: 'rect',
      drawingPath: 'xl/drawings/drawing1.xml',
      drawingIndex: 2,
    })
    expect(parsed.drawingPath).toBe('xl/drawings/drawing1.xml')
    expect(parsed.drawingIndex).toBe(2)
  })

  it('accepts the sidecar chart state fields (legend/dLbls/axis titles/grouping/dPt)', () => {
    const parsed = visualSchema.parse({
      id: 'visual-2',
      sheetId: 'sheet-1',
      kind: 'chart',
      anchor,
      chartPath: 'xl/charts/chart1.xml',
      chart: {
        chartTypes: ['barChart'],
        barDirection: 'col',
        title: 'Sales',
        legend: 'bottom',
        dataLabels: 'value',
        grouping: 'stacked',
        axisTitles: { category: 'Month' },
        categoryAxisFormat: 'd-mmm',
        series: [
          {
            name: 'S1',
            categories: ['a', 'b'],
            values: [1, 2],
            categoryFormat: 'mmm\\-yy',
            pointColors: [{ index: 1, color: '#00AA00' }],
          },
        ],
      },
    })
    expect(parsed.chart?.legend).toBe('bottom')
    expect(parsed.chart?.grouping).toBe('stacked')
    expect(parsed.chart?.categoryAxisFormat).toBe('d-mmm')
    expect(parsed.chart?.series[0]?.categoryFormat).toBe('mmm\\-yy')
    expect(parsed.chart?.series[0]?.pointColors?.[0]).toEqual({ index: 1, color: '#00AA00' })
  })

  it('still accepts visuals without a locator and rejects unknown keys', () => {
    expect(() =>
      visualSchema.parse({
        id: 'visual-1',
        sheetId: 'sheet-1',
        kind: 'shape',
        anchor,
      }),
    ).not.toThrow()
    expect(() =>
      visualSchema.parse({
        id: 'visual-1',
        sheetId: 'sheet-1',
        kind: 'shape',
        anchor,
        bogus: true,
      }),
    ).toThrow()
    expect(() =>
      visualSchema.parse({
        id: 'visual-1',
        sheetId: 'sheet-1',
        kind: 'shape',
        anchor,
        drawingPath: '../../etc/passwd',
      }),
    ).toThrow()
  })
})
