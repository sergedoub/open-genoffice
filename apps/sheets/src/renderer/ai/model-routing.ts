import type { CompactionOptions } from '@genoffice/agent-core'
import type { AiModelSummary, AiRoute } from '@genoffice/ai-provider'
import type { ModelPickerModel } from '@genoffice/ui'
import type {
  ListAiModelsArgs,
  ListAiModelsResult,
  PublicAiSettings,
} from '../../shared/desktop-api'
import { ATTACHMENT_IMAGE_EXTS, type AttachmentMeta } from '../../shared/desktop-api'

export interface PublicAiRendererBridge {
  getAiPublicSettings(): Promise<PublicAiSettings>
  listAiModels(args?: ListAiModelsArgs): Promise<ListAiModelsResult>
  getAiConversationRoute(identity: { projectId: string; chatId: string }): Promise<AiRoute>
  setAiConversationRoute(
    identity: { projectId: string; chatId: string },
    route: AiRoute,
  ): Promise<AiRoute>
}

export function publicAiBridge(value: unknown): PublicAiRendererBridge | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<PublicAiRendererBridge>
  return typeof candidate.getAiPublicSettings === 'function' &&
    typeof candidate.listAiModels === 'function' &&
    typeof candidate.getAiConversationRoute === 'function' &&
    typeof candidate.setAiConversationRoute === 'function'
    ? (candidate as PublicAiRendererBridge)
    : null
}

export function modelSupportsImage(model: AiModelSummary | null | undefined): boolean {
  return model?.capabilities.inputModalities.includes('image') === true
}

export function isCompatibleModel(model: AiModelSummary, requireImageInput = false): boolean {
  const capabilities = model.capabilities
  return (
    model.available &&
    capabilities.inputModalities.includes('text') &&
    capabilities.outputModalities.includes('text') &&
    capabilities.supportsTools &&
    (!requireImageInput || capabilities.inputModalities.includes('image'))
  )
}

export function compatibleModels(
  models: readonly AiModelSummary[],
  requireImageInput = false,
): AiModelSummary[] {
  return models.filter((model) => isCompatibleModel(model, requireImageInput))
}

export function routeModel(
  models: readonly AiModelSummary[],
  route: AiRoute | null,
): AiModelSummary | undefined {
  if (!route) return undefined
  return models.find((model) => model.providerId === route.providerId && model.id === route.modelId)
}

export function toPickerModels(
  models: readonly AiModelSummary[],
  providerLabels: ReadonlyMap<string, string>,
): ModelPickerModel[] {
  return models.map((model) => {
    const context = model.capabilities.contextWindow
    return {
      providerId: model.providerId,
      modelId: model.id,
      providerLabel: providerLabels.get(model.providerId) ?? model.providerId,
      label: model.name,
      shortLabel: model.name,
      ...(model.description ? { description: model.description } : {}),
      capabilityLabels: [
        ...(modelSupportsImage(model) ? ['Images'] : []),
        ...(context ? [`${Math.round(context / 1_000)}K context`] : []),
      ],
      searchTerms: [model.id, model.canonicalId],
    }
  })
}

export function preserveUnavailableSelection(
  models: readonly ModelPickerModel[],
  selection: AiRoute | null,
  label: string,
  providerLabel: string,
  reason: string,
): ModelPickerModel[] {
  if (
    !selection ||
    models.some(
      (model) => model.providerId === selection.providerId && model.modelId === selection.modelId,
    )
  ) {
    return [...models]
  }
  return [
    ...models,
    {
      providerId: selection.providerId,
      modelId: selection.modelId,
      providerLabel,
      label,
      shortLabel: label,
      description: reason,
      capabilityLabels: ['Unavailable'],
      searchTerms: [selection.modelId],
    },
  ]
}

export function hasImageAttachments(attachments: readonly AttachmentMeta[]): boolean {
  return attachments.some((attachment) => ATTACHMENT_IMAGE_EXTS.has(attachment.ext))
}

export function partitionAttachmentsForModel(
  attachments: readonly AttachmentMeta[],
  supportsImages: boolean,
): { accepted: AttachmentMeta[]; rejectedImages: AttachmentMeta[] } {
  if (supportsImages) return { accepted: [...attachments], rejectedImages: [] }
  const accepted: AttachmentMeta[] = []
  const rejectedImages: AttachmentMeta[] = []
  for (const attachment of attachments) {
    if (ATTACHMENT_IMAGE_EXTS.has(attachment.ext)) rejectedImages.push(attachment)
    else accepted.push(attachment)
  }
  return { accepted, rejectedImages }
}

/** Conservative byte budget leaves room for tools, workbook context and output. */
export function compactionForModel(model: AiModelSummary): CompactionOptions | false {
  const contextWindow = model.capabilities.contextWindow
  if (!contextWindow) return {}
  const maxBytes = Math.max(32 * 1024, Math.floor(contextWindow * 3 * 0.7))
  return {
    maxBytes,
    keepRecentBytes: Math.min(96 * 1024, Math.max(16 * 1024, Math.floor(maxBytes * 0.375))),
  }
}
