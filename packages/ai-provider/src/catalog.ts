import { httpBodyDetail } from './http-error'
import { OPENROUTER_API_BASE_URL } from './providers'
import type { AiModelCapabilities, AiModelModality, AiModelPricing, AiModelSummary } from './types'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface AiModelCompatibilityRequirements {
  /** Require image input when the model-visible conversation already contains images. */
  imageInput?: boolean
}

export interface AiModelCatalog {
  providerId: 'openrouter'
  models: AiModelSummary[]
  fetchedAt: string
  /** Forwarded for the main-process cache, which owns freshness policy. */
  cacheControl?: string
  etag?: string
}

export interface OpenRouterCatalogOptions {
  fetch?: FetchLike
  signal?: AbortSignal
  now?: Date
  requirements?: AiModelCompatibilityRequirements
}

const KNOWN_MODALITIES = new Set<AiModelModality>([
  'text',
  'image',
  'file',
  'audio',
  'video',
  'embeddings',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function modalities(value: unknown): AiModelModality[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is AiModelModality =>
      typeof item === 'string' && KNOWN_MODALITIES.has(item as AiModelModality),
  )
}

function price(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function redactSecret(value: string, secret: string): string {
  return secret ? value.split(secret).join('[REDACTED]') : value
}

function normalizePricing(value: unknown): AiModelPricing | undefined {
  if (!isRecord(value)) return undefined
  const pricing: AiModelPricing = {}
  const promptPerToken = price(value.prompt)
  const completionPerToken = price(value.completion)
  const image = price(value.image)
  const request = price(value.request)
  if (promptPerToken !== undefined) pricing.promptPerToken = promptPerToken
  if (completionPerToken !== undefined) pricing.completionPerToken = completionPerToken
  if (image !== undefined) pricing.image = image
  if (request !== undefined) pricing.request = request
  return Object.keys(pricing).length ? pricing : undefined
}

function normalizeOpenRouterModel(raw: unknown, now: Date): AiModelSummary | null {
  if (!isRecord(raw)) return null
  const id = stringValue(raw.id)
  if (!id) return null

  const architecture = isRecord(raw.architecture) ? raw.architecture : {}
  const topProvider = isRecord(raw.top_provider) ? raw.top_provider : {}
  const inputModalities = modalities(architecture.input_modalities)
  const outputModalities = modalities(architecture.output_modalities)
  const supportedParameters = Array.isArray(raw.supported_parameters)
    ? raw.supported_parameters.filter((item): item is string => typeof item === 'string')
    : []

  const expirationValue = raw.expiration_date
  const expiresAt = expirationValue === null ? null : (stringValue(expirationValue) ?? null)
  const expirationTime = expiresAt === null ? null : Date.parse(expiresAt)
  const expirationIsValid = expirationTime === null || Number.isFinite(expirationTime)
  const isExpired = expirationTime !== null && expirationIsValid && expirationTime <= now.getTime()
  const explicitlyInactive =
    raw.active === false || raw.is_active === false || raw.status === 'inactive'

  const capabilities: AiModelCapabilities = {
    inputModalities,
    outputModalities,
    supportsTools: supportedParameters.includes('tools'),
    contextWindow: positiveInteger(raw.context_length),
    maxOutputTokens: positiveInteger(topProvider.max_completion_tokens),
  }

  const created =
    typeof raw.created === 'number' && Number.isFinite(raw.created) ? raw.created : null
  const createdAt = created !== null ? new Date(created * 1000).toISOString() : undefined
  const description = stringValue(raw.description)
  const model: AiModelSummary = {
    id,
    canonicalId: stringValue(raw.canonical_slug) ?? id,
    providerId: 'openrouter',
    name: stringValue(raw.name) ?? id,
    expiresAt,
    available: expirationIsValid && !isExpired && !explicitlyInactive,
    capabilities,
  }
  if (description) model.description = description
  if (createdAt) model.createdAt = createdAt
  const pricing = normalizePricing(raw.pricing)
  if (pricing) model.pricing = pricing
  return model
}

/** Normalize the remote OpenRouter response without hiding incompatible entries. */
export function normalizeOpenRouterModels(payload: unknown, now = new Date()): AiModelSummary[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return []
  return payload.data
    .map((model) => normalizeOpenRouterModel(model, now))
    .filter((model): model is AiModelSummary => model !== null)
}

/** GenOffice's minimum agent contract: text in/out, tools, and current availability. */
export function isAiModelCompatible(
  model: AiModelSummary,
  requirements: AiModelCompatibilityRequirements = {},
): boolean {
  const { capabilities } = model
  return (
    model.available &&
    capabilities.inputModalities.includes('text') &&
    capabilities.outputModalities.includes('text') &&
    capabilities.supportsTools &&
    (!requirements.imageInput || capabilities.inputModalities.includes('image'))
  )
}

export function filterCompatibleModels(
  models: readonly AiModelSummary[],
  requirements: AiModelCompatibilityRequirements = {},
): AiModelSummary[] {
  return models.filter((model) => isAiModelCompatible(model, requirements))
}

/** Fetch the key-filtered OpenRouter catalog and return only GenOffice-compatible models. */
export async function fetchOpenRouterModelCatalog(
  apiKey: string,
  options: OpenRouterCatalogOptions = {},
): Promise<AiModelCatalog> {
  if (!apiKey.trim()) throw new Error('An OpenRouter API key is required')
  const fetchImpl = options.fetch ?? fetch
  const now = options.now ?? new Date()
  const requestInit: RequestInit = {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  }
  if (options.signal) requestInit.signal = options.signal
  const response = await fetchImpl(`${OPENROUTER_API_BASE_URL}/models/user`, requestInit)
  if (!response.ok) {
    throw new Error(
      `OpenRouter models HTTP ${response.status}: ${redactSecret(
        httpBodyDetail(await response.text()),
        apiKey,
      )}`,
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('OpenRouter models returned an invalid JSON response')
  }
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('OpenRouter models returned an invalid response')
  }

  const catalog: AiModelCatalog = {
    providerId: 'openrouter',
    models: filterCompatibleModels(normalizeOpenRouterModels(payload, now), options.requirements),
    fetchedAt: now.toISOString(),
  }
  const cacheControl = response.headers.get('cache-control')
  const etag = response.headers.get('etag')
  if (cacheControl) catalog.cacheControl = cacheControl
  if (etag) catalog.etag = etag
  return catalog
}
