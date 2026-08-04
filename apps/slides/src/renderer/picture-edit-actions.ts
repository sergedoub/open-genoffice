/**
 * Picture crop and cutout (background removal) actions. Extracted from
 * App.tsx; functions read the latest App state through ActionCtx.
 */
import type { PictureRenderNode } from '@genoffice/pptx-render'
import { FIT_WIDTH } from './app-constants'
import type { ActionCtx } from './action-context'
import { t } from './i18n/locale'

/** Enter picture crop mode: find the selected picture node and read its box and srcRect */
export function startCrop(ctx: ActionCtx): void {
  if (!ctx.slide || ctx.selectedIds.length !== 1) return
  const id = ctx.selectedIds[0]!
  const node = ctx.slide.nodes.find((n) => n.sourceId === id)
  if (!node || node.type !== 'picture') return
  const picNode = node as PictureRenderNode
  ctx.setCropTarget({
    sourceId: id,
    box: { x: picNode.box.x, y: picNode.box.y, w: picNode.box.w, h: picNode.box.h },
    srcRect: picNode.srcRect,
  })
}

export async function commitCrop(
  ctx: ActionCtx,
  rect: { l: number; t: number; r: number; b: number } | null,
): Promise<void> {
  if (!ctx.cropTarget) return
  const sourceId = ctx.cropTarget.sourceId
  ctx.setCropTarget(null)
  const updated = await window.slidesApi.editPictureSrcRect({
    slideIndex: ctx.current,
    sourceId,
    srcRect: rect,
  })
  if (updated) {
    ctx.applySlide(ctx.current, updated)
    ctx.setDirty(true)
    ctx.setStatus(rect ? t('appStatusCropApplied') : t('appStatusCropRemoved'))
  }
}

export function cancelCrop(ctx: ActionCtx): void {
  ctx.setCropTarget(null)
}

// ── Picture cutout (background removal) ───────────────────────────────────────

/** Enter cutout mode: a single selected picture (except audio/video poster frames) → open the tolerance preview dialog */
export function startCutout(ctx: ActionCtx): void {
  if (!ctx.slide || ctx.selectedIds.length !== 1) return
  const node = ctx.slide.nodes.find((n) => n.sourceId === ctx.selectedIds[0])
  if (!node || node.type !== 'picture') return
  const pic = node as PictureRenderNode
  if (pic.media) {
    ctx.setStatus(t('appStatusCutoutMediaUnsupported'))
    return
  }
  if (!pic.dataUrl) {
    ctx.setStatus(t('appStatusCutoutNoData'))
    return
  }
  ctx.setCutoutTarget({ sourceId: pic.sourceId, dataUrl: pic.dataUrl })
}

/**
 * Apply the cutout result: insert the background-removed PNG at the same position/size
 * (inheriting rotation/crop), then delete the original. Replacement is composed from existing
 * IPC (no direct source-swap IPC); the new image ends up on top.
 * TODO: if the original z-order must be strictly preserved, append reorderElement steps to move it down.
 */
export async function applyCutout(ctx: ActionCtx, pngDataUrl: string): Promise<void> {
  if (!ctx.cutoutTarget || !ctx.slide) return
  const targetId = ctx.cutoutTarget.sourceId
  const node = ctx.slide.nodes.find((n) => n.sourceId === targetId)
  ctx.setCutoutTarget(null)
  if (!node || node.type !== 'picture') return
  const pic = node as PictureRenderNode
  const base64 = pngDataUrl.split(',')[1]
  if (!base64) {
    ctx.setStatus(t('appStatusCutoutEncodeFailed'))
    return
  }
  const added = await window.slidesApi.addImageBytes({
    slideIndex: ctx.current,
    base64,
    ext: 'png',
    xPx: Math.round(pic.box.x),
    yPx: Math.round(pic.box.y),
    wPx: Math.max(1, Math.round(pic.box.w)),
    hPx: Math.max(1, Math.round(pic.box.h)),
    fitWidthPx: FIT_WIDTH,
    name: pic.name ? `${pic.name} (background removed)` : 'Background-removed image',
  })
  if (!added || 'error' in added) {
    ctx.setStatus(t('appStatusCutoutInsertFailed'))
    return
  }
  let updated = added.slide
  // Inherit rotation (addImageBytes takes no rotation parameter)
  if (pic.box.rotationDeg) {
    const r = await window.slidesApi.editTransform({
      slideIndex: ctx.current,
      sourceId: added.sourceId,
      xPx: pic.box.x,
      yPx: pic.box.y,
      wPx: pic.box.w,
      hPx: pic.box.h,
      rotationDeg: pic.box.rotationDeg,
      fitWidthPx: FIT_WIDTH,
    })
    if (r) updated = r
  }
  // Inherit crop (the result PNG is processed from the full source image, srcRect semantics unchanged)
  if (pic.srcRect) {
    const r = await window.slidesApi.editPictureSrcRect({
      slideIndex: ctx.current,
      sourceId: added.sourceId,
      srcRect: pic.srcRect,
    })
    if (r) updated = r
  }
  const afterDelete = await window.slidesApi.deleteElement({
    slideIndex: ctx.current,
    sourceId: targetId,
  })
  if (afterDelete) updated = afterDelete
  ctx.applySlide(ctx.current, updated)
  ctx.setSelectedIds([added.sourceId])
  ctx.setDirty(true)
  ctx.setStatus(t('appStatusCutoutDone'))
}
