import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { cssRgb } from './DrawLayer'
import type { TFunc } from './i18n/locale'

const PAD_W = 420
const PAD_H = 150

/** Signature strokes: pad pixel coords, scaled proportionally and y-flipped when placed on the page */
export interface SignatureStrokes {
  paths: number[][]
  width: number
  height: number
}

/** True text-to-stroke conversion is impractical — tracing glyph outlines via canvas is too
    heavy, so approximate with bitmap-derived paths: text mode samples stroke points from a
    canvas, so what's written to disk is still an Ink annotation (vector, scalable). */
function textToStrokes(text: string, font: string): SignatureStrokes | null {
  const canvas = document.createElement('canvas')
  canvas.width = PAD_W
  canvas.height = PAD_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, PAD_W, PAD_H)
  ctx.fillStyle = '#000'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font
  ctx.fillText(text, PAD_W / 2, PAD_H / 2, PAD_W - 24)

  // Scan column by column for ink runs, emitting a short vertical stroke per run — keeps the glyph shape without true vectorization
  const { data } = ctx.getImageData(0, 0, PAD_W, PAD_H)
  const paths: number[][] = []
  for (let x = 0; x < PAD_W; x += 2) {
    let runStart = -1
    for (let y = 0; y < PAD_H; y++) {
      const dark = data[(y * PAD_W + x) * 4]! < 128
      if (dark && runStart < 0) runStart = y
      else if (!dark && runStart >= 0) {
        if (y - runStart > 1) paths.push([x, runStart, x, y - 1])
        runStart = -1
      }
    }
    if (runStart >= 0) paths.push([x, runStart, x, PAD_H - 1])
  }
  return paths.length > 0 ? { paths, width: PAD_W, height: PAD_H } : null
}

/** Signature dialog: draw on a pad or type text to generate; confirming enters placement mode */
export function SignatureDialog({
  color,
  t,
  onCancel,
  onConfirm,
}: {
  color: [number, number, number]
  t: TFunc
  onCancel: () => void
  onConfirm: (sig: SignatureStrokes) => void
}): ReactElement {
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [typed, setTyped] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pathsRef = useRef<number[][]>([])
  const curRef = useRef<number[] | null>(null)

  const redraw = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = cssRgb(color)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const p of pathsRef.current) {
      ctx.beginPath()
      ctx.moveTo(p[0]!, p[1]!)
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!)
      ctx.stroke()
    }
  }

  useEffect(redraw, [color, mode])

  const pos = (e: ReactPointerEvent): [number, number] => {
    const box = e.currentTarget.getBoundingClientRect()
    return [e.clientX - box.left, e.clientY - box.top]
  }

  const down = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    curRef.current = pos(e)
    pathsRef.current = [...pathsRef.current, curRef.current]
  }
  const move = (e: ReactPointerEvent) => {
    if (!curRef.current) return
    const [x, y] = pos(e)
    curRef.current.push(x, y)
    redraw()
  }
  const up = () => {
    curRef.current = null
  }

  const clear = () => {
    pathsRef.current = []
    redraw()
  }

  const confirm = () => {
    if (mode === 'draw') {
      const paths = pathsRef.current.filter((p) => p.length >= 4)
      if (paths.length > 0) onConfirm({ paths, width: PAD_W, height: PAD_H })
      return
    }
    const text = typed.trim()
    if (!text) return
    const sig = textToStrokes(text, `italic 56px "Snell Roundhand", "Segoe Script", cursive`)
    if (sig) onConfirm(sig)
  }

  const canConfirm = mode === 'draw' || typed.trim().length > 0

  return (
    <div className="pdf-modal-mask" onClick={onCancel}>
      <div className="pdf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pdf-modal-title">{t('signTitle')}</div>
        <div className="pdf-sign-tabs">
          <button className={`pdf-sign-tab${mode === 'draw' ? ' active' : ''}`} onClick={() => setMode('draw')}>
            {t('signDraw')}
          </button>
          <button className={`pdf-sign-tab${mode === 'type' ? ' active' : ''}`} onClick={() => setMode('type')}>
            {t('signType')}
          </button>
        </div>
        {mode === 'draw' ? (
          <canvas
            ref={canvasRef}
            className="pdf-sign-pad"
            width={PAD_W}
            height={PAD_H}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
        ) : (
          <>
            <input
              className="pdf-modal-input"
              value={typed}
              placeholder={t('signTypePlaceholder')}
              autoFocus
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirm()}
            />
            <div className="pdf-sign-preview" style={{ color: cssRgb(color) }}>
              {typed || t('signTypePlaceholder')}
            </div>
          </>
        )}
        <div className="pdf-modal-actions">
          {mode === 'draw' && (
            <button className="pdf-modal-btn" onClick={clear}>
              {t('signClear')}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="pdf-modal-btn" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button className="pdf-modal-btn primary" disabled={!canConfirm} onClick={confirm}>
            {t('signPlace')}
          </button>
        </div>
        <div className="pdf-sign-hint">{t('signHint')}</div>
      </div>
    </div>
  )
}
