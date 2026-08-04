import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { pdfRectToCss } from './annotations'
import type { PageGeom } from './annotations'
import type { FormValueInput } from '../shared/ipc'

interface Widget {
  fieldName: string
  kind: 'text' | 'checkbox' | 'radio' | 'choice'
  rect: [number, number, number, number]
  value: string
  checked: boolean
  multiLine: boolean
  readOnly: boolean
  /** radio: this button's exportValue */
  buttonValue: string
  /** choice: option list */
  options: { exportValue: string; displayValue: string }[]
}

interface RawAnnotation {
  subtype?: string
  fieldType?: string
  fieldName?: string
  fieldValue?: unknown
  exportValue?: string
  buttonValue?: string
  rect?: number[]
  readOnly?: boolean
  checkBox?: boolean
  radioButton?: boolean
  pushButton?: boolean
  multiLine?: boolean
  options?: { exportValue?: unknown; displayValue?: unknown }[]
}

function fieldValueStr(v: unknown): string {
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' ? s : ''
}

/** AcroForm overlay: text fields/checkboxes absolutely positioned on the page; App aggregates values, ⌘S writes back */
export function FormLayer({
  doc,
  pageNo,
  geom,
  scale,
  readOnly = false,
  edits,
  onEdit,
}: {
  doc: PDFDocumentProxy
  pageNo: number
  geom: PageGeom
  scale: number
  readOnly?: boolean
  edits: ReadonlyMap<string, FormValueInput>
  onEdit: (value: FormValueInput) => void
}): ReactElement | null {
  const [widgets, setWidgets] = useState<Widget[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const page = await doc.getPage(pageNo)
      const annots = (await page.getAnnotations()) as RawAnnotation[]
      if (cancelled) return
      const out: Widget[] = []
      for (const a of annots) {
        if (a.subtype !== 'Widget' || !a.fieldName || !a.rect) continue
        const base = {
          fieldName: a.fieldName,
          rect: a.rect as Widget['rect'],
          checked: false,
          multiLine: false,
          readOnly: !!a.readOnly,
          buttonValue: '',
          options: [] as Widget['options'],
        }
        if (a.fieldType === 'Tx') {
          out.push({
            ...base,
            kind: 'text',
            value: typeof a.fieldValue === 'string' ? a.fieldValue : '',
            multiLine: !!a.multiLine,
          })
        } else if (a.fieldType === 'Btn' && a.checkBox) {
          out.push({
            ...base,
            kind: 'checkbox',
            value: '',
            checked: typeof a.fieldValue === 'string' && a.fieldValue !== 'Off' && a.fieldValue !== '',
          })
        } else if (a.fieldType === 'Btn' && a.radioButton) {
          out.push({
            ...base,
            kind: 'radio',
            value: fieldValueStr(a.fieldValue),
            buttonValue: typeof a.buttonValue === 'string' ? a.buttonValue : '',
          })
        } else if (a.fieldType === 'Ch') {
          out.push({
            ...base,
            kind: 'choice',
            value: fieldValueStr(a.fieldValue),
            options: (a.options ?? [])
              .filter((o) => typeof o.exportValue === 'string' || typeof o.displayValue === 'string')
              .map((o) => ({
                exportValue: String(o.exportValue ?? o.displayValue),
                displayValue: String(o.displayValue ?? o.exportValue),
              })),
          })
        }
      }
      setWidgets(out)
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageNo])

  if (!widgets || widgets.length === 0) return null

  return (
    <div className="pdf-form-layer">
      {widgets.map((w, i) => {
        const style = pdfRectToCss(geom, w.rect, scale)
        const edit = edits.get(w.fieldName)
        if (w.kind === 'checkbox') {
          return (
            <input
              key={i}
              type="checkbox"
              className="pdf-form-checkbox"
              style={style}
              disabled={readOnly || w.readOnly}
              checked={edit ? !!edit.checked : w.checked}
              onChange={(e) => onEdit({ name: w.fieldName, kind: 'checkbox', checked: e.target.checked })}
            />
          )
        }
        const value = edit ? (edit.value ?? '') : w.value
        if (w.kind === 'radio') {
          return (
            <input
              key={i}
              type="radio"
              className="pdf-form-checkbox"
              style={style}
              disabled={readOnly || w.readOnly}
              checked={value === w.buttonValue}
              onChange={() => onEdit({ name: w.fieldName, kind: 'radio', value: w.buttonValue })}
            />
          )
        }
        if (w.kind === 'choice') {
          const known = w.options.some((o) => o.exportValue === value)
          return (
            <select
              key={i}
              className="pdf-form-select"
              style={{ ...style, fontSize: Math.max(9, Math.min(14, style.height * 0.55)) }}
              disabled={readOnly || w.readOnly}
              value={value}
              onChange={(e) => onEdit({ name: w.fieldName, kind: 'choice', value: e.target.value })}
            >
              {!known && <option value={value} hidden />}
              {w.options.map((o, j) => (
                <option key={j} value={o.exportValue}>
                  {o.displayValue}
                </option>
              ))}
            </select>
          )
        }
        const fontSize = Math.max(9, Math.min(14, style.height * 0.55))
        if (w.multiLine) {
          return (
            <textarea
              key={i}
              className="pdf-form-input"
              style={{ ...style, fontSize }}
              disabled={readOnly || w.readOnly}
              value={value}
              onChange={(e) => onEdit({ name: w.fieldName, kind: 'text', value: e.target.value })}
            />
          )
        }
        return (
          <input
            key={i}
            type="text"
            className="pdf-form-input"
            style={{ ...style, fontSize }}
            disabled={readOnly || w.readOnly}
            value={value}
            onChange={(e) => onEdit({ name: w.fieldName, kind: 'text', value: e.target.value })}
          />
        )
      })}
    </div>
  )
}
