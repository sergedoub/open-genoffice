/**
 * Picture crop mode overlay.
 *
 * Entry: context menu "Crop picture" → receives the picture node's box + current srcRect.
 * Interaction: drag 8 handles to adjust the crop frame; Enter / click outside to confirm; Esc to cancel.
 * Output: onConfirm({ l, t, r, b }) or onCancel().
 *
 * Coordinate system: everything in the Konva Stage's CSS px (fitWidth viewport).
 * srcRect l/t/r/b are 0..1 crop ratios (OOXML semantics: the fraction cropped from each edge).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from './i18n/locale'

export interface CropRect {
  l: number
  t: number
  r: number
  b: number
}

export interface NodeBox {
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  /** The picture element's pixel box (in the fitWidth viewport coordinate system) */
  box: NodeBox
  /** Existing crop (0..1); undefined means no crop */
  srcRect?: CropRect
  onConfirm: (rect: CropRect | null) => void
  onCancel: () => void
}

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLE_SIZE = 8
const HANDLE_HALF = HANDLE_SIZE / 2

/**
 * Positions of the 8 handles relative to the crop frame's top-left
 */
function handlePositions(cx: number, cy: number, cw: number, ch: number) {
  const mx = cx + cw / 2
  const my = cy + ch / 2
  const ex = cx + cw
  const ey = cy + ch
  return {
    nw: { x: cx, y: cy },
    n: { x: mx, y: cy },
    ne: { x: ex, y: cy },
    e: { x: ex, y: my },
    se: { x: ex, y: ey },
    s: { x: mx, y: ey },
    sw: { x: cx, y: ey },
    w: { x: cx, y: my },
  } as Record<HandleId, { x: number; y: number }>
}

/**
 * srcRect (0..1 ratios) → pixel crop frame (relative to the stage coordinate system)
 */
function rectFromSrcRect(box: NodeBox, sr: CropRect) {
  const cx = box.x + sr.l * box.w
  const cy = box.y + sr.t * box.h
  const cw = box.w * (1 - sr.l - sr.r)
  const ch = box.h * (1 - sr.t - sr.b)
  return { cx, cy, cw, ch }
}

/**
 * Pixel crop frame → srcRect 0..1
 */
function srcRectFromRect(box: NodeBox, cx: number, cy: number, cw: number, ch: number): CropRect {
  const l = (cx - box.x) / box.w
  const t = (cy - box.y) / box.h
  const r = (box.x + box.w - cx - cw) / box.w
  const b = (box.y + box.h - cy - ch) / box.h
  return {
    l: Math.max(0, Math.min(0.95, l)),
    t: Math.max(0, Math.min(0.95, t)),
    r: Math.max(0, Math.min(0.95, r)),
    b: Math.max(0, Math.min(0.95, b)),
  }
}

export function CropOverlay({ box, srcRect, onConfirm, onCancel }: Props) {
  const { t } = useI18n()
  const initial = srcRect ?? { l: 0, t: 0, r: 0, b: 0 }
  const initRect = rectFromSrcRect(box, initial)
  const [cx, setCx] = useState(initRect.cx)
  const [cy, setCy] = useState(initRect.cy)
  const [cw, setCw] = useState(initRect.cw)
  const [ch, setCh] = useState(initRect.ch)

  const dragRef = useRef<{
    handle: HandleId
    startMouseX: number
    startMouseY: number
    startCx: number
    startCy: number
    startCw: number
    startCh: number
  } | null>(null)

  const onMouseDown = useCallback(
    (handle: HandleId, e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      dragRef.current = {
        handle,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startCx: cx,
        startCy: cy,
        startCw: cw,
        startCh: ch,
      }
    },
    [cx, cy, cw, ch],
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.startMouseX
      const dy = e.clientY - d.startMouseY
      const MIN = 20
      let nx = d.startCx,
        ny = d.startCy,
        nw = d.startCw,
        nh = d.startCh
      switch (d.handle) {
        case 'nw':
          nx = Math.min(d.startCx + dx, d.startCx + d.startCw - MIN)
          ny = Math.min(d.startCy + dy, d.startCy + d.startCh - MIN)
          nw = d.startCw - (nx - d.startCx)
          nh = d.startCh - (ny - d.startCy)
          break
        case 'n':
          ny = Math.min(d.startCy + dy, d.startCy + d.startCh - MIN)
          nh = d.startCh - (ny - d.startCy)
          break
        case 'ne':
          ny = Math.min(d.startCy + dy, d.startCy + d.startCh - MIN)
          nh = d.startCh - (ny - d.startCy)
          nw = Math.max(d.startCw + dx, MIN)
          break
        case 'e':
          nw = Math.max(d.startCw + dx, MIN)
          break
        case 'se':
          nw = Math.max(d.startCw + dx, MIN)
          nh = Math.max(d.startCh + dy, MIN)
          break
        case 's':
          nh = Math.max(d.startCh + dy, MIN)
          break
        case 'sw':
          nx = Math.min(d.startCx + dx, d.startCx + d.startCw - MIN)
          nw = d.startCw - (nx - d.startCx)
          nh = Math.max(d.startCh + dy, MIN)
          break
        case 'w':
          nx = Math.min(d.startCx + dx, d.startCx + d.startCw - MIN)
          nw = d.startCw - (nx - d.startCx)
          break
      }
      // Clamp within the picture bounds
      nx = Math.max(box.x, nx)
      ny = Math.max(box.y, ny)
      nw = Math.min(nw, box.x + box.w - nx)
      nh = Math.min(nh, box.y + box.h - ny)
      setCx(nx)
      setCy(ny)
      setCw(nw)
      setCh(nh)
    }
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [box])

  // Keyboard: Enter confirm, Esc cancel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        const r = srcRectFromRect(box, cx, cy, cw, ch)
        const isEmpty = !r.l && !r.t && !r.r && !r.b
        onConfirm(isEmpty ? null : r)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [box, cx, cy, cw, ch, onConfirm, onCancel])

  const confirm = useCallback(() => {
    const r = srcRectFromRect(box, cx, cy, cw, ch)
    const isEmpty = !r.l && !r.t && !r.r && !r.b
    onConfirm(isEmpty ? null : r)
  }, [box, cx, cy, cw, ch, onConfirm])

  const handles = handlePositions(cx, cy, cw, ch)

  const CURSOR: Record<HandleId, string> = {
    nw: 'nwse-resize',
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize',
  }

  return (
    <div
      className="crop-overlay"
      onMouseDown={(e) => {
        // Clicking outside the handles = confirm
        e.stopPropagation()
        confirm()
      }}
      style={{ position: 'absolute', inset: 0, cursor: 'default' }}
    >
      {/* Mask layer: translucent outside the crop frame */}
      {/* top */}
      <div
        className="crop-mask"
        style={{ left: box.x, top: box.y, width: box.w, height: cy - box.y }}
      />
      {/* bottom */}
      <div
        className="crop-mask"
        style={{ left: box.x, top: cy + ch, width: box.w, height: box.y + box.h - cy - ch }}
      />
      {/* left (middle strip) */}
      <div className="crop-mask" style={{ left: box.x, top: cy, width: cx - box.x, height: ch }} />
      {/* right (middle strip) */}
      <div
        className="crop-mask"
        style={{ left: cx + cw, top: cy, width: box.x + box.w - cx - cw, height: ch }}
      />

      {/* Crop frame border */}
      <div
        className="crop-frame"
        style={{ left: cx, top: cy, width: cw, height: ch }}
        onMouseDown={(e) => e.stopPropagation()}
      />

      {/* The 8 handles */}
      {(Object.entries(handles) as [HandleId, { x: number; y: number }][]).map(([id, pos]) => (
        <div
          key={id}
          className="crop-handle"
          style={{
            left: pos.x - HANDLE_HALF,
            top: pos.y - HANDLE_HALF,
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            cursor: CURSOR[id],
          }}
          onMouseDown={(e) => onMouseDown(id, e)}
        />
      ))}

      {/* Confirmation hint */}
      <div className="crop-hint" style={{ left: box.x, top: box.y + box.h + 8 }}>
        {t('appCropHint')}
      </div>
    </div>
  )
}
