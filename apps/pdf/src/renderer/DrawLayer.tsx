import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { pdfToView, viewToPdf } from './annotations'
import type { PageGeom } from './annotations'
import type { DrawingInput } from '../shared/ipc'

export type DrawTool = 'ink' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'note'

export interface LocalDrawing {
  id: string
  input: DrawingInput
}

/** 5-color palette (0-1 rgb), same visual language as the markup floating bar */
export const DRAW_COLORS: { name: string; rgb: [number, number, number] }[] = [
  { name: 'red', rgb: [0.86, 0.22, 0.18] },
  { name: 'yellow', rgb: [1, 0.78, 0.13] },
  { name: 'green', rgb: [0.13, 0.65, 0.35] },
  { name: 'blue', rgb: [0.17, 0.4, 1] },
  { name: 'black', rgb: [0.15, 0.15, 0.15] },
]

export const cssRgb = (c: readonly [number, number, number]): string =>
  `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`

/** Drawing SVG paths: PDF space → displayed page pixels */
function toView(geom: PageGeom, scale: number, x: number, y: number): [number, number] {
  const [vx, vy] = pdfToView(geom, x, y)
  return [vx * scale, vy * scale]
}

function drawingShape(d: DrawingInput, geom: PageGeom, scale: number): ReactElement | null {
  if (d.kind === 'note') return null
  const stroke = cssRgb(d.color)
  const w = d.width * scale
  if (d.kind === 'ink') {
    return (
      <>
        {d.paths.map((path, i) => {
          const pts: string[] = []
          for (let j = 0; j < path.length; j += 2) {
            const [vx, vy] = toView(geom, scale, path[j]!, path[j + 1]!)
            pts.push(`${vx},${vy}`)
          }
          return (
            <polyline
              key={i}
              points={pts.join(' ')}
              fill="none"
              stroke={stroke}
              strokeWidth={w}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        })}
      </>
    )
  }
  if (d.kind === 'rect' || d.kind === 'ellipse') {
    const [ax, ay] = toView(geom, scale, d.rect[0], d.rect[1])
    const [bx, by] = toView(geom, scale, d.rect[2], d.rect[3])
    const [x, y] = [Math.min(ax, bx), Math.min(ay, by)]
    const [rw, rh] = [Math.abs(bx - ax), Math.abs(by - ay)]
    return d.kind === 'rect' ? (
      <rect x={x} y={y} width={rw} height={rh} fill="none" stroke={stroke} strokeWidth={w} />
    ) : (
      <ellipse cx={x + rw / 2} cy={y + rh / 2} rx={rw / 2} ry={rh / 2} fill="none" stroke={stroke} strokeWidth={w} />
    )
  }
  const [fx, fy] = toView(geom, scale, d.from[0], d.from[1])
  const [tx, ty] = toView(geom, scale, d.to[0], d.to[1])
  const head: ReactElement[] = []
  if (d.kind === 'arrow') {
    const ang = Math.atan2(ty - fy, tx - fx)
    const len = Math.max(9 * scale, w * 4.5)
    for (const [i, off] of [-0.45, 0.45].entries()) {
      head.push(
        <line
          key={i}
          x1={tx}
          y1={ty}
          x2={tx - len * Math.cos(ang + off)}
          y2={ty - len * Math.sin(ang + off)}
          stroke={stroke}
          strokeWidth={w}
          strokeLinecap="round"
        />,
      )
    }
  }
  return (
    <>
      <line x1={fx} y1={fy} x2={tx} y2={ty} stroke={stroke} strokeWidth={w} strokeLinecap="round" />
      {head}
    </>
  )
}

/**
 * Draw layer: with a tool active it takes over pointer events to draw on the page;
 * otherwise it only renders existing shapes (click to select; deletion is an explicit App action).
 * Notes are placed at the click point; content is entered via an App dialog.
 */
export function DrawLayer({
  geom,
  scale,
  pageWidth,
  pageHeight,
  drawings,
  tool,
  color,
  strokeWidth,
  selectedId,
  selectTitle,
  onCommit,
  onNoteAt,
  onSelect,
}: {
  geom: PageGeom
  scale: number
  pageWidth: number
  pageHeight: number
  drawings: LocalDrawing[]
  tool: DrawTool | null
  color: [number, number, number]
  strokeWidth: number
  selectedId: string | null
  selectTitle: string
  onCommit: (input: DrawingInput) => void
  onNoteAt: (at: [number, number]) => void
  onSelect: (id: string, x: number, y: number) => void
}): ReactElement {
  // In-progress stroke/drag, all in PDF-space coordinates
  const [live, setLive] = useState<DrawingInput | null>(null)
  const startRef = useRef<[number, number] | null>(null)
  const inkRef = useRef<number[]>([])

  const toPdf = (e: ReactPointerEvent): [number, number] => {
    const box = e.currentTarget.getBoundingClientRect()
    return viewToPdf(geom, (e.clientX - box.left) / scale, (e.clientY - box.top) / scale)
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!tool || e.button !== 0) return
    e.preventDefault()
    const at = toPdf(e)
    if (tool === 'note') {
      onNoteAt(at)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    startRef.current = at
    if (tool === 'ink') {
      inkRef.current = [at[0], at[1]]
      setLive({ kind: 'ink', pageIndex: 0, color, width: strokeWidth, paths: [inkRef.current] })
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!tool || !startRef.current) return
    const at = toPdf(e)
    if (tool === 'ink') {
      inkRef.current = [...inkRef.current, at[0], at[1]]
      setLive({ kind: 'ink', pageIndex: 0, color, width: strokeWidth, paths: [inkRef.current] })
    } else if (tool === 'rect' || tool === 'ellipse') {
      const [sx, sy] = startRef.current
      setLive({
        kind: tool,
        pageIndex: 0,
        color,
        width: strokeWidth,
        rect: [Math.min(sx, at[0]), Math.min(sy, at[1]), Math.max(sx, at[0]), Math.max(sy, at[1])],
      })
    } else if (tool === 'line' || tool === 'arrow') {
      setLive({ kind: tool, pageIndex: 0, color, width: strokeWidth, from: startRef.current, to: at })
    }
  }

  const onPointerUp = () => {
    const pending = live
    startRef.current = null
    inkRef.current = []
    setLive(null)
    if (!pending) return
    // Discard empty shapes from a click-and-release
    if (pending.kind === 'ink' && (pending.paths[0]?.length ?? 0) < 6) return
    if (pending.kind === 'rect' || pending.kind === 'ellipse') {
      const [x1, y1, x2, y2] = pending.rect
      if (x2 - x1 < 3 && y2 - y1 < 3) return
    }
    if (pending.kind === 'line' || pending.kind === 'arrow') {
      if (Math.hypot(pending.to[0] - pending.from[0], pending.to[1] - pending.from[1]) < 4) return
    }
    onCommit(pending)
  }

  return (
    <>
      <svg
        className={`pdf-draw-layer${tool ? ' pdf-draw-active' : ''}`}
        width={pageWidth * scale}
        height={pageHeight * scale}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {drawings.map((d) =>
          d.input.kind === 'note' ? null : (
            <g
              key={d.id}
              className={`pdf-draw-shape${d.id === selectedId ? ' pdf-draw-selected' : ''}`}
              onClick={(e) => !tool && onSelect(d.id, e.clientX, e.clientY)}
              style={{ pointerEvents: tool ? 'none' : 'stroke' }}
            >
              <title>{selectTitle}</title>
              {drawingShape(d.input, geom, scale)}
            </g>
          ),
        )}
        {live && drawingShape(live, geom, scale)}
      </svg>
      {drawings
        .filter((d) => d.input.kind === 'note')
        .map((d) => {
          const note = d.input as Extract<DrawingInput, { kind: 'note' }>
          const [vx, vy] = toView(geom, scale, note.at[0], note.at[1])
          return (
            <button
              key={d.id}
              className={`pdf-note-pin${d.id === selectedId ? ' pdf-note-pin-selected' : ''}`}
              style={{ left: vx, top: vy - 20, background: cssRgb(note.color) }}
              title={`${note.contents}\n\n${selectTitle}`}
              onClick={(e) => onSelect(d.id, e.clientX, e.clientY)}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="1.6" aria-hidden>
                <path d="M2.5 3.5h11v8h-6l-3 2.5V11.5h-2z" strokeLinejoin="round" />
              </svg>
            </button>
          )
        })}
    </>
  )
}
