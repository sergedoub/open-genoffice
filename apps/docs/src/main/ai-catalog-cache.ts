import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AI_PROVIDERS,
  fetchOpenRouterModelCatalog,
  filterCompatibleModels,
  type AiModelCatalog,
  type AiModelCompatibilityRequirements,
  type AiModelSummary,
  type AiProviderId,
} from '@genoffice/ai-provider'
import type { AiModelCatalogState, ListAiModelsResult, PublicAiProviderId } from '../shared/ipc'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface CachedCatalogFile {
  schemaVersion: 1
  providerId: PublicAiProviderId
  models: AiModelSummary[]
  fetchedAt: string
  maxAgeSeconds: number
  cacheControl?: string
  etag?: string
}

export interface AiCatalogCacheOptions {
  cacheDir: string
  getApiKey(providerId: Exclude<PublicAiProviderId, 'genspark'>): string | null
  fetch?: FetchLike
  now?: () => Date
}

const FALLBACK_MAX_AGE_SECONDS = 300

function providerDefinition(providerId: AiProviderId) {
  return AI_PROVIDERS.find((provider) => provider.id === providerId)
}

function parseMaxAge(cacheControl?: string): number {
  if (!cacheControl) return FALLBACK_MAX_AGE_SECONDS
  const match = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(cacheControl)
  if (!match) return FALLBACK_MAX_AGE_SECONDS
  const seconds = Number(match[1])
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : FALLBACK_MAX_AGE_SECONDS
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCachedModel(value: unknown, providerId: PublicAiProviderId): value is AiModelSummary {
  if (!isRecord(value) || value.providerId !== providerId) return false
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.canonicalId !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.available !== 'boolean' ||
    !isRecord(value.capabilities)
  ) {
    return false
  }
  const capabilities = value.capabilities
  return (
    Array.isArray(capabilities.inputModalities) &&
    capabilities.inputModalities.every((item) => typeof item === 'string') &&
    Array.isArray(capabilities.outputModalities) &&
    capabilities.outputModalities.every((item) => typeof item === 'string') &&
    typeof capabilities.supportsTools === 'boolean' &&
    (capabilities.contextWindow === null || typeof capabilities.contextWindow === 'number') &&
    (capabilities.maxOutputTokens === null || typeof capabilities.maxOutputTokens === 'number')
  )
}

function parseCachedCatalog(
  value: unknown,
  providerId: PublicAiProviderId,
): CachedCatalogFile | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.providerId !== providerId) return null
  if (!Array.isArray(value.models) || typeof value.fetchedAt !== 'string') return null
  if (!value.models.every((model) => isCachedModel(model, providerId))) return null
  if (Number.isNaN(Date.parse(value.fetchedAt))) return null
  const maxAgeSeconds = value.maxAgeSeconds
  if (typeof maxAgeSeconds !== 'number' || !Number.isFinite(maxAgeSeconds) || maxAgeSeconds < 0) {
    return null
  }
  return value as unknown as CachedCatalogFile
}

function normalizeStaticModel(
  providerId: PublicAiProviderId,
  id: string,
  createdAt?: string,
): AiModelSummary {
  const provider = providerDefinition(providerId)
  const model: AiModelSummary = {
    id,
    canonicalId: id,
    providerId,
    name: id,
    expiresAt: null,
    available: true,
    capabilities: {
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportsTools: true,
      contextWindow: null,
      maxOutputTokens: null,
    },
  }
  if (createdAt) model.createdAt = createdAt
  if (provider?.label) model.description = `${provider.label} model`
  return model
}

function accessibleIds(payload: unknown): Array<{ id: string; createdAt?: string }> {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return []
  return payload.data.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id) return []
    let createdAt: string | undefined
    if (typeof entry.created_at === 'string' && !Number.isNaN(Date.parse(entry.created_at))) {
      createdAt = entry.created_at
    } else if (typeof entry.created === 'number' && Number.isFinite(entry.created)) {
      createdAt = new Date(entry.created * 1000).toISOString()
    }
    return [{ id: entry.id, ...(createdAt ? { createdAt } : {}) }]
  })
}

function conservativeRemoteModels(
  providerId: Extract<PublicAiProviderId, 'anthropic' | 'openai'>,
  payload: unknown,
): AiModelSummary[] {
  const allowed = new Set(providerDefinition(providerId)?.models ?? [])
  return accessibleIds(payload)
    .filter(({ id }) => allowed.has(id))
    .map(({ id, createdAt }) => normalizeStaticModel(providerId, id, createdAt))
}

export class AiCatalogCache {
  private readonly memory = new Map<PublicAiProviderId, CachedCatalogFile>()
  private readonly inFlight = new Map<PublicAiProviderId, Promise<CachedCatalogFile>>()
  private readonly generations = new Map<PublicAiProviderId, number>()
  private readonly errors = new Map<PublicAiProviderId, string>()
  private readonly fetchImpl: FetchLike
  private readonly now: () => Date

  constructor(private readonly options: AiCatalogCacheOptions) {
    this.fetchImpl = options.fetch ?? fetch
    this.now = options.now ?? (() => new Date())
  }

  async list(
    providerIds: readonly PublicAiProviderId[],
    requirements: AiModelCompatibilityRequirements = {},
    forceRefresh = false,
  ): Promise<ListAiModelsResult> {
    const uniqueProviderIds = [...new Set(providerIds)]
    const catalogs = await Promise.all(
      uniqueProviderIds.map((providerId) => this.loadForList(providerId, forceRefresh)),
    )
    const states: AiModelCatalogState[] = catalogs.map(({ catalog, stale, providerId }) => {
      const state: AiModelCatalogState = {
        providerId,
        fetchedAt: catalog?.fetchedAt ?? null,
        stale,
      }
      const error = this.errors.get(providerId)
      if (error) state.error = error
      return state
    })
    const models = catalogs
      .flatMap(({ catalog }) => catalog?.models ?? [])
      .filter((model) => filterCompatibleModels([model], requirements).length === 1)
      .sort((a, b) => {
        const providerOrder = uniqueProviderIds.indexOf(a.providerId as PublicAiProviderId)
        const otherProviderOrder = uniqueProviderIds.indexOf(b.providerId as PublicAiProviderId)
        return providerOrder - otherProviderOrder || a.name.localeCompare(b.name)
      })
    return { models, catalogs: states }
  }

  async refresh(
    providerIds: readonly PublicAiProviderId[],
    requirements: AiModelCompatibilityRequirements = {},
  ): Promise<ListAiModelsResult> {
    return this.list(providerIds, requirements, true)
  }

  invalidate(providerId: PublicAiProviderId): void {
    this.memory.delete(providerId)
  }

  clear(providerId: PublicAiProviderId): void {
    this.memory.delete(providerId)
    this.generations.set(providerId, (this.generations.get(providerId) ?? 0) + 1)
    this.inFlight.delete(providerId)
    const path = this.path(providerId)
    if (existsSync(path)) unlinkSync(path)
  }

  private async loadForList(
    providerId: PublicAiProviderId,
    forceRefresh: boolean,
  ): Promise<{
    providerId: PublicAiProviderId
    catalog: CachedCatalogFile | null
    stale: boolean
  }> {
    if (providerId === 'genspark') {
      const catalog = this.staticGensparkCatalog()
      return { providerId, catalog, stale: false }
    }

    const cached = this.read(providerId)
    if (forceRefresh) {
      try {
        return { providerId, catalog: await this.refreshOne(providerId), stale: false }
      } catch (error) {
        this.errors.set(providerId, error instanceof Error ? error.message : String(error))
        return { providerId, catalog: cached, stale: Boolean(cached) }
      }
    }
    if (!cached) {
      try {
        return { providerId, catalog: await this.refreshOne(providerId), stale: false }
      } catch (error) {
        this.errors.set(providerId, error instanceof Error ? error.message : String(error))
        return { providerId, catalog: null, stale: true }
      }
    }
    const stale = this.isStale(cached)
    if (stale) {
      void this.refreshOne(providerId).catch((error) => {
        this.errors.set(providerId, error instanceof Error ? error.message : String(error))
      })
    }
    return { providerId, catalog: cached, stale }
  }

  private isStale(catalog: CachedCatalogFile): boolean {
    const ageMs = this.now().getTime() - Date.parse(catalog.fetchedAt)
    return !Number.isFinite(ageMs) || ageMs >= catalog.maxAgeSeconds * 1000
  }

  private staticGensparkCatalog(): CachedCatalogFile {
    const provider = providerDefinition('genspark')!
    return {
      schemaVersion: 1,
      providerId: 'genspark',
      models: provider.models.map((id) => normalizeStaticModel('genspark', id)),
      fetchedAt: this.now().toISOString(),
      maxAgeSeconds: Number.MAX_SAFE_INTEGER,
    }
  }

  private read(providerId: PublicAiProviderId): CachedCatalogFile | null {
    const memory = this.memory.get(providerId)
    if (memory) return memory
    const path = this.path(providerId)
    if (!existsSync(path)) return null
    try {
      const parsed = parseCachedCatalog(JSON.parse(readFileSync(path, 'utf8')), providerId)
      if (parsed) this.memory.set(providerId, parsed)
      return parsed
    } catch {
      return null
    }
  }

  private refreshOne(
    providerId: Exclude<PublicAiProviderId, 'genspark'>,
  ): Promise<CachedCatalogFile> {
    const existing = this.inFlight.get(providerId)
    if (existing) return existing
    const generation = this.generations.get(providerId) ?? 0
    const promise = this.fetchRemote(providerId)
      .then((catalog) => {
        if ((this.generations.get(providerId) ?? 0) === generation) {
          this.write(catalog)
          this.errors.delete(providerId)
        }
        return catalog
      })
      .finally(() => {
        if (this.inFlight.get(providerId) === promise) this.inFlight.delete(providerId)
      })
    this.inFlight.set(providerId, promise)
    return promise
  }

  private async fetchRemote(
    providerId: Exclude<PublicAiProviderId, 'genspark'>,
  ): Promise<CachedCatalogFile> {
    const apiKey = this.options.getApiKey(providerId)
    if (!apiKey)
      throw new Error(`${providerDefinition(providerId)?.label ?? providerId} is not configured`)
    if (providerId === 'openrouter') {
      const catalog: AiModelCatalog = await fetchOpenRouterModelCatalog(apiKey, {
        fetch: this.fetchImpl,
        now: this.now(),
      })
      return this.toCached(
        catalog.providerId,
        catalog.models,
        catalog.fetchedAt,
        catalog.cacheControl,
        catalog.etag,
      )
    }

    const isAnthropic = providerId === 'anthropic'
    const response = await this.fetchImpl(
      isAnthropic
        ? 'https://api.anthropic.com/v1/models?limit=1000'
        : 'https://api.openai.com/v1/models',
      {
        method: 'GET',
        headers: isAnthropic
          ? {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
            }
          : { Authorization: `Bearer ${apiKey}` },
      },
    )
    if (!response.ok)
      throw new Error(
        `${providerDefinition(providerId)?.label ?? providerId} models HTTP ${response.status}`,
      )
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(
        `${providerDefinition(providerId)?.label ?? providerId} models returned invalid JSON`,
      )
    }
    const models = conservativeRemoteModels(providerId, payload)
    return this.toCached(
      providerId,
      models,
      this.now().toISOString(),
      response.headers.get('cache-control') ?? undefined,
      response.headers.get('etag') ?? undefined,
    )
  }

  private toCached(
    providerId: Exclude<PublicAiProviderId, 'genspark'>,
    models: AiModelSummary[],
    fetchedAt: string,
    cacheControl?: string,
    etag?: string,
  ): CachedCatalogFile {
    const catalog: CachedCatalogFile = {
      schemaVersion: 1,
      providerId,
      models,
      fetchedAt,
      maxAgeSeconds: parseMaxAge(cacheControl),
    }
    if (cacheControl) catalog.cacheControl = cacheControl
    if (etag) catalog.etag = etag
    return catalog
  }

  private path(providerId: PublicAiProviderId): string {
    return join(this.options.cacheDir, `${providerId}.json`)
  }

  private write(catalog: CachedCatalogFile): void {
    mkdirSync(this.options.cacheDir, { recursive: true })
    const path = this.path(catalog.providerId)
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tempPath, JSON.stringify(catalog, null, 2), 'utf8')
    renameSync(tempPath, path)
    this.memory.set(catalog.providerId, catalog)
  }
}

export { parseMaxAge as parseCatalogMaxAge }
