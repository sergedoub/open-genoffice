import type { AiModelSummary, AiRoute } from './types'

/** OpenRouter's model ids for paid-capable and free-only routing. */
export const OPENROUTER_AUTO_MODEL_ID = 'openrouter/auto'
export const OPENROUTER_FREE_MODEL_ID = 'openrouter/free'

export function isFreeModelId(modelId: string | undefined): boolean {
  return modelId === OPENROUTER_FREE_MODEL_ID || modelId?.endsWith(':free') === true
}

/** Pricing metadata is remote and may be absent, so model ids remain the primary signal. */
export function isFreeModel(model: AiModelSummary | undefined): boolean {
  if (!model) return false
  if (isFreeModelId(model.id)) return true
  return model.pricing?.promptPerToken === 0 && model.pricing?.completionPerToken === 0
}

export function openRouterRetryRoute(failedRoute: AiRoute, failedModel?: AiModelSummary): AiRoute {
  return {
    providerId: 'openrouter',
    modelId:
      isFreeModel(failedModel) || isFreeModelId(failedRoute.modelId)
        ? OPENROUTER_FREE_MODEL_ID
        : OPENROUTER_AUTO_MODEL_ID,
  }
}

export function openRouterRetrySuggestion(
  failedRoute: AiRoute,
  failedModel?: AiModelSummary,
): string {
  const retryRoute = openRouterRetryRoute(failedRoute, failedModel)
  return isFreeModel(failedModel) || isFreeModelId(failedRoute.modelId)
    ? `Try again with OpenRouter Free Router (${retryRoute.modelId}) to keep this retry free.`
    : `Try again with OpenRouter Auto Router (${retryRoute.modelId}).`
}
