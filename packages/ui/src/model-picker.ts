import type React from 'react'

export interface ModelPickerSelection {
  readonly providerId: string
  readonly modelId: string
}

/**
 * A provider-neutral model row. Callers own capability filtering and provide
 * human-readable capability/metadata labels; the picker never infers support
 * from provider-specific model IDs.
 */
export interface ModelPickerModel extends ModelPickerSelection {
  readonly providerLabel: string
  readonly label: string
  readonly shortLabel?: string | undefined
  readonly description?: string | undefined
  readonly capabilityLabels?: readonly string[] | undefined
  readonly searchTerms?: readonly string[] | undefined
  readonly providerIcon?: React.ReactNode
}

export interface ModelPickerGroup {
  readonly providerId: string
  readonly providerLabel: string
  readonly models: readonly ModelPickerModel[]
}

/**
 * The provider order used by the model picker. Unknown providers remain
 * available after these first-party categories in their input order.
 */
export const MODEL_PICKER_PROVIDER_ORDER = [
  'genspark',
  'openrouter',
  'openai',
  'anthropic',
] as const

export function modelPickerKey(model: ModelPickerSelection): string {
  return `${model.providerId}\u0000${model.modelId}`
}

export function isModelPickerSelection(
  model: ModelPickerSelection,
  selection: ModelPickerSelection | null | undefined,
): boolean {
  return selection != null && modelPickerKey(model) === modelPickerKey(selection)
}

export function findModelPickerSelection(
  models: readonly ModelPickerModel[],
  selection: ModelPickerSelection | null | undefined,
): ModelPickerModel | undefined {
  if (!selection) return undefined
  return models.find((model) => isModelPickerSelection(model, selection))
}

export function filterModelPickerModels(
  models: readonly ModelPickerModel[],
  query: string,
): ModelPickerModel[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)

  if (terms.length === 0) return [...models]

  return models.filter((model) => {
    const haystack = [
      model.label,
      model.shortLabel,
      model.modelId,
      model.providerLabel,
      model.providerId,
      ...(model.searchTerms ?? []),
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLocaleLowerCase()

    return terms.every((term) => haystack.includes(term))
  })
}

/** Preserve the caller's provider and model ordering. */
export function groupModelPickerModels(
  models: readonly ModelPickerModel[],
  providerOrder: readonly string[] = [],
): ModelPickerGroup[] {
  const groups = new Map<string, { providerLabel: string; models: ModelPickerModel[] }>()

  for (const model of models) {
    const existing = groups.get(model.providerId)
    if (existing) {
      existing.models.push(model)
    } else {
      groups.set(model.providerId, {
        providerLabel: model.providerLabel,
        models: [model],
      })
    }
  }

  const result = Array.from(groups, ([providerId, group]) => ({
    providerId,
    providerLabel: group.providerLabel,
    models: group.models,
  }))

  if (providerOrder.length === 0) return result

  const order = new Map(providerOrder.map((providerId, index) => [providerId, index]))
  return result
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const aOrder = order.get(a.group.providerId) ?? providerOrder.length
      const bOrder = order.get(b.group.providerId) ?? providerOrder.length
      return aOrder - bOrder || a.index - b.index
    })
    .map(({ group }) => group)
}

export function nextModelPickerIndex(
  currentIndex: number,
  itemCount: number,
  direction: 1 | -1,
): number {
  if (itemCount <= 0) return -1
  if (currentIndex < 0) return direction === 1 ? 0 : itemCount - 1
  return (currentIndex + direction + itemCount) % itemCount
}
