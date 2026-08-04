import type { CompactionOptions } from '@genoffice/agent-core'
import type { AiModelSummary, AiRoute } from '@genoffice/ai-provider'
import type { ModelPickerModel } from '@genoffice/ui'
import type { ProjectChatMessage, PublicAiProvider } from '../../shared/ipc'

/** Keep headroom for prompts, tool schemas, and provider tokenization differences. */
export function modelCompactionBudget(model: AiModelSummary): CompactionOptions | false {
  const tokens = model.capabilities.contextWindow
  if (!tokens || tokens <= 0) return { maxBytes: 256_000, keepRecentBytes: 96_000 }
  const maxBytes = Math.max(32_000, Math.floor(tokens * 3 * 0.8))
  return {
    maxBytes,
    keepRecentBytes: Math.max(12_000, Math.floor(maxBytes * 0.375)),
  }
}

export function isPdfCompatibleModel(model: AiModelSummary): boolean {
  return (
    model.available &&
    model.capabilities.inputModalities.includes('text') &&
    model.capabilities.outputModalities.includes('text') &&
    model.capabilities.supportsTools
  )
}

export function toPickerModel(
  model: AiModelSummary,
  providers: readonly PublicAiProvider[],
): ModelPickerModel {
  const providerLabel = providers.find((provider) => provider.id === model.providerId)?.label
  const capabilityLabels = [
    model.capabilities.inputModalities.includes('image') ? 'Images' : 'Text only',
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

export function routeEquals(left: AiRoute | null | undefined, right: AiRoute | null | undefined) {
  return (
    left != null &&
    right != null &&
    left.providerId === right.providerId &&
    left.modelId === right.modelId
  )
}

export function latestTranscriptRoute(
  messages: readonly ProjectChatMessage[],
): AiRoute | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const provenance = messages[index]?.ai
    const route = provenance?.resolved ?? provenance?.requested
    if (route) return route
  }
  return undefined
}

export type RestoredPdfChatEntry =
  | {
      role: 'user' | 'assistant'
      text: string
      tools?: ProjectChatMessage['tools']
    }
  | { role: 'divider'; text: string }

/** Reconstruct non-model-context model-switch dividers from stored assistant provenance. */
export function restorePdfTranscript(
  messages: readonly ProjectChatMessage[],
): RestoredPdfChatEntry[] {
  const entries: RestoredPdfChatEntry[] = []
  let previousRoute: AiRoute | null = null
  for (const message of messages) {
    const route =
      message.role === 'assistant' ? (message.ai?.resolved ?? message.ai?.requested) : undefined
    if (route && previousRoute && !routeEquals(route, previousRoute)) {
      entries.push({ role: 'divider', text: `Switched to ${route.modelId}` })
    }
    entries.push({
      role: message.role,
      text: message.text,
      ...(message.tools ? { tools: message.tools } : {}),
    })
    if (route) previousRoute = route
  }
  return entries
}
