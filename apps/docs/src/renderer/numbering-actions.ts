/**
 * List numbering actions: allocating numIds, new list definitions, restart /
 * continue numbering. Extracted from App.tsx; the App component passes a
 * NumberingContext built fresh per call so state never goes stale.
 */
import type { Editor } from '@tiptap/core'
import type { CustomNumberingLevel, NumberingDef } from '@genoffice/docx-engine'
import type { DocState, PendingNumbering } from './doc-state'
import { t } from './i18n/locale'

/** The App state the numbering actions need; built fresh per call. */
export interface NumberingContext {
  editor: Editor | null
  doc: DocState | null
  pendingNumbering: PendingNumbering
  setPendingNumbering: (update: (prev: PendingNumbering) => PendingNumbering) => void
  numIdFloorRef: { current: number }
  setStatus: (status: string) => void
}

export function nextNumId(ctx: NumberingContext): string {
  let max = 2 // the blank template occupies 1/2
  for (const id of ctx.doc?.parsed.numbering.keys() ?? [])
    max = Math.max(max, parseInt(id, 10) || 0)
  for (const d of ctx.pendingNumbering.newDefs) max = Math.max(max, parseInt(d.numId, 10) || 0)
  for (const r of ctx.pendingNumbering.restartNums) max = Math.max(max, parseInt(r.numId, 10) || 0)
  max = Math.max(max, ctx.numIdFloorRef.current)
  ctx.numIdFloorRef.current = max + 1
  return String(max + 1)
}

/** Instant display of editor markers: inject pending definitions into listNumbering storage (re-parsing takes over after save) */
export function overlayNumberingDef(ctx: NumberingContext, def: NumberingDef): void {
  if (!ctx.editor) return
  const store = ctx.editor.storage.listNumbering as { defs: Map<string, NumberingDef> }
  store.defs = new Map(store.defs).set(def.numId, def)
}

/** Fallback when a new list can't reuse a numId: adopt an existing same-kind definition, otherwise create a new one */
export function createNumberingDef(ctx: NumberingContext, kind: 'bullet' | 'ordered'): string {
  // brand-new abstractNum + num (blank template style; when the part is missing the engine creates the part too)
  const numId = nextNumId(ctx)
  ctx.setPendingNumbering((p) => ({ ...p, newDefs: [...p.newDefs, { numId, kind }] }))
  overlayNumberingDef(ctx, {
    numId,
    abstractNumId: `pending-${numId}`,
    levels: Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [
        i,
        {
          numFmt: kind === 'bullet' ? 'bullet' : 'decimal',
          lvlText: kind === 'bullet' ? '' : `%${i + 1}.`,
          start: 1,
          indentLeft: 720 * (i + 1),
          hanging: 360,
        },
      ]),
    ),
    startOverrides: {},
  })
  return numId
}

/** New list definitions with custom levels (bullet library / numbering library / multilevel gallery / define dialog) */
export function createCustomListDef(
  ctx: NumberingContext,
  levels: CustomNumberingLevel[],
): string | null {
  if (!ctx.doc || levels.length === 0) return null
  const kind = levels[0].numFmt === 'bullet' ? ('bullet' as const) : ('ordered' as const)
  const numId = nextNumId(ctx)
  ctx.setPendingNumbering((p) => ({ ...p, newDefs: [...p.newDefs, { numId, kind, levels }] }))
  overlayNumberingDef(ctx, {
    numId,
    abstractNumId: `pending-${numId}`,
    levels: Object.fromEntries(
      levels.map((l, i) => [
        i,
        {
          numFmt: l.numFmt,
          lvlText: l.lvlText,
          start: l.start ?? 1,
          indentLeft: l.indentLeft,
          hanging: l.hanging ?? 360,
        },
      ]),
    ),
    startOverrides: {},
  })
  return numId
}

export function allocateListNumId(
  ctx: NumberingContext,
  kind: 'bullet' | 'ordered',
): string | null {
  if (!ctx.doc) return null
  // the document already has a same-kind numbering definition (even if unused in the body): the new num points at its abstractNum
  const match = [...ctx.doc.parsed.numbering.values()].find(
    (d) => (d.levels[0]?.numFmt === 'bullet') === (kind === 'bullet'),
  )
  if (match) {
    const numId = nextNumId(ctx)
    ctx.setPendingNumbering((p) => ({
      ...p,
      restartNums: [
        ...p.restartNums,
        { numId, abstractNumId: match.abstractNumId, startOverrides: { 0: 1 } },
      ],
    }))
    overlayNumberingDef(ctx, { ...match, numId, startOverrides: { 0: 1 } })
    return numId
  }
  return createNumberingDef(ctx, kind)
}

/** From the cursor's block onward, move list items sharing the numId to a new numId (Word: restart applies to all later items of that list) */
export function rewriteNumIdForward(
  ctx: NumberingContext,
  oldNumId: string,
  newNumId: string,
): void {
  if (!ctx.editor) return
  const { state, view } = ctx.editor
  const startIdx = state.selection.$from.index(0)
  let tr = state.tr
  state.doc.forEach((node, offset, idx) => {
    if (idx < startIdx) return
    if (node.type.name === 'docListItem' && node.attrs.numId === oldNumId) {
      tr = tr.setNodeMarkup(offset, undefined, { ...node.attrs, numId: newNumId })
    }
  })
  view.dispatch(tr)
}

/** Context menu: restart numbering (new num + startOverride pointing at the same abstractNum;
 *  lists with no definition (numId=0 / CSS counters) get a new definition, naturally starting at 1) */
export function restartNumbering(ctx: NumberingContext): void {
  if (!ctx.editor || !ctx.doc) return
  const attrs = ctx.editor.getAttributes('docListItem')
  const oldNumId = attrs?.numId as string | null
  if (oldNumId == null) return
  const store = ctx.editor.storage.listNumbering as { defs: Map<string, NumberingDef> }
  const def = store.defs.get(String(oldNumId)) ?? ctx.doc.parsed.numbering.get(String(oldNumId))
  let numId: string
  if (def) {
    const ilvl = Number(attrs.ilvl) || 0
    numId = nextNumId(ctx)
    ctx.setPendingNumbering((p) => ({
      ...p,
      restartNums: [
        ...p.restartNums,
        { numId, abstractNumId: def.abstractNumId, startOverrides: { [ilvl]: 1 } },
      ],
    }))
    overlayNumberingDef(ctx, { ...def, numId, startOverrides: { [ilvl]: 1 } })
  } else {
    numId = createNumberingDef(ctx, (attrs.kind as 'bullet' | 'ordered') ?? 'ordered')
  }
  rewriteNumIdForward(ctx, String(oldNumId), numId)
  ctx.setStatus(t('appNumberingRestarted'))
}

/** Context menu: continue numbering (merge back into the previous list's numId; the count continues) */
export function continueNumbering(ctx: NumberingContext): void {
  if (!ctx.editor) return
  const attrs = ctx.editor.getAttributes('docListItem')
  const curNumId = attrs?.numId as string | null
  if (!curNumId) return
  const { state } = ctx.editor
  const startIdx = state.selection.$from.index(0)
  let prevNumId: string | null = null
  state.doc.forEach((node, _offset, idx) => {
    if (idx >= startIdx) return
    if (node.type.name === 'docListItem' && node.attrs.numId && node.attrs.numId !== curNumId) {
      prevNumId = node.attrs.numId as string
    }
  })
  if (!prevNumId) return
  rewriteNumIdForward(ctx, String(curNumId), prevNumId)
  ctx.setStatus(t('appNumberingContinued'))
}
