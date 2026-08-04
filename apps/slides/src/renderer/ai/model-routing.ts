import type { CompactionOptions } from '@genoffice/agent-core'
import type { AiModelSummary, AiRoute, PublicAiProvider } from '../../shared/ipc'
import type { ModelPickerModel } from '@genoffice/ui'

const MODEL_CONTEXT_HEADROOM = 0.8
const APPROX_BYTES_PER_TOKEN = 3

export const IMAGE_UNSUPPORTED_NOTICE =
  'This model does not accept images. Choose an image-capable model to paste, drop, or attach one.'

export function modelSupportsImages(model: AiModelSummary | undefined): boolean {
  return model?.capabilities.inputModalities.includes('image') === true
}

export function modelCompactionBudget(model: AiModelSummary): CompactionOptions | false {
  const tokens = model.capabilities.contextWindow
  if (!tokens || tokens <= 0) return false
  const maxBytes = Math.max(
    32_000,
    Math.floor(tokens * APPROX_BYTES_PER_TOKEN * MODEL_CONTEXT_HEADROOM),
  )
  return {
    maxBytes,
    keepRecentBytes: Math.max(12_000, Math.floor(maxBytes * 0.375)),
  }
}

export function modelForRoute(
  models: readonly AiModelSummary[],
  route: AiRoute | null | undefined,
): AiModelSummary | undefined {
  if (!route) return undefined
  return models.find((model) => model.providerId === route.providerId && model.id === route.modelId)
}

export function compatibleModels(
  models: readonly AiModelSummary[],
  requireImageInput: boolean,
): AiModelSummary[] {
  return models.filter(
    (model) =>
      model.available &&
      model.capabilities.inputModalities.includes('text') &&
      model.capabilities.outputModalities.includes('text') &&
      model.capabilities.supportsTools &&
      (!requireImageInput || modelSupportsImages(model)),
  )
}

export function toPickerModel(
  model: AiModelSummary,
  providers: readonly PublicAiProvider[],
): ModelPickerModel {
  const providerLabel = providers.find((provider) => provider.id === model.providerId)?.label
  const capabilityLabels = [
    modelSupportsImages(model) ? 'Images' : 'Text only',
    model.capabilities.contextWindow
      ? `${Math.round(model.capabilities.contextWindow / 1000)}K context`
      : undefined,
  ].filter((label): label is string => Boolean(label))

  return {
    providerId: model.providerId,
    modelId: model.id,
    providerLabel: providerLabel ?? model.providerId,
    label: model.name,
    shortLabel: model.name,
    description: model.description,
    capabilityLabels,
    searchTerms: [model.id, model.canonicalId],
  }
}
