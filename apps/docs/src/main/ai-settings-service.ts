import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  AI_PROVIDERS,
  defaultAiSettings,
  resolveAiSettings,
  verifyProviderApiKey,
  type AiProviderConfig,
  type AiProviderId,
  type AiProviderVerificationResult,
  type AiRoute,
  type AiSettings,
  type LegacyAiSettings,
} from '@genoffice/ai-provider'
import type {
  ListAiModelsArgs,
  ListAiModelsResult,
  PublicAiProvider,
  PublicAiProviderId,
  PublicAiSettings,
  RefreshAiModelsArgs,
  VerifyAndSaveAiProviderArgs,
  VerifyAndSaveAiProviderResult,
} from '../shared/ipc'
import { AiCatalogCache } from './ai-catalog-cache'
import { AiSecretStore, redactProviderError, type SecretCipher } from './ai-secret-store'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface PersistedProviderState {
  verifiedAt?: string
  accountLabel?: string
  usable?: boolean
  baseUrl?: string
}

interface PersistedAiSettings {
  schemaVersion: 2
  globalDefault: AiRoute
  providers: Partial<Record<AiProviderId, PersistedProviderState>>
}

export interface AiSettingsServiceOptions {
  settingsPath: string
  secretStore: AiSecretStore
  catalogs: AiCatalogCache
  isGensparkConfigured(): boolean
  fetch?: FetchLike
}

const PUBLIC_PROVIDER_IDS = ['genspark', 'openrouter', 'anthropic', 'openai'] as const
const DEFAULT_ROUTE: AiRoute = {
  providerId: 'genspark',
  modelId:
    AI_PROVIDERS.find((provider) => provider.id === 'genspark')?.defaultModel ?? 'claude-opus-4-7',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProviderId(value: unknown): value is AiProviderId {
  return AI_PROVIDERS.some((provider) => provider.id === value)
}

function normalizeRoute(value: unknown): AiRoute | null {
  if (!isRecord(value) || !isProviderId(value.providerId)) return null
  if (typeof value.modelId !== 'string' || !value.modelId.trim()) return null
  return { providerId: value.providerId, modelId: value.modelId.trim() }
}

function normalizePersistedSettings(value: unknown): PersistedAiSettings | null {
  if (!isRecord(value) || value.schemaVersion !== 2) return null
  const globalDefault = normalizeRoute(value.globalDefault)
  if (!globalDefault || !isRecord(value.providers)) return null
  const providers: PersistedAiSettings['providers'] = {}
  for (const [id, raw] of Object.entries(value.providers)) {
    if (!isProviderId(id) || !isRecord(raw)) continue
    const provider: PersistedProviderState = {}
    if (typeof raw.verifiedAt === 'string' && !Number.isNaN(Date.parse(raw.verifiedAt))) {
      provider.verifiedAt = raw.verifiedAt
    }
    if (typeof raw.accountLabel === 'string' && raw.accountLabel)
      provider.accountLabel = raw.accountLabel
    if (typeof raw.usable === 'boolean') provider.usable = raw.usable
    if (typeof raw.baseUrl === 'string' && raw.baseUrl) provider.baseUrl = raw.baseUrl
    providers[id] = provider
  }
  return { schemaVersion: 2, globalDefault, providers }
}

function redactVerification(
  result: AiProviderVerificationResult,
  apiKey: string,
): AiProviderVerificationResult {
  if (result.ok) return result
  return {
    ...result,
    error: { ...result.error, message: redactProviderError(result.error.message, [apiKey]) },
  }
}

export function createSafeStorageCipher(safeStorage: SafeStorageLike): SecretCipher {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  }
}

export class AiSettingsService {
  private state: PersistedAiSettings | null = null

  constructor(private readonly options: AiSettingsServiceOptions) {}

  getPublicSettings(): PublicAiSettings {
    const state = this.load()
    return {
      schemaVersion: 1,
      globalDefault: { ...state.globalDefault },
      providers: PUBLIC_PROVIDER_IDS.map((providerId) => this.publicProvider(providerId, state)),
      secureStorageAvailable: this.options.secretStore.isEncryptionAvailable(),
    }
  }

  getLegacyPublicSettings(): AiSettings {
    const state = this.load()
    const settings = defaultAiSettings()
    settings.provider = state.globalDefault.providerId
    settings.providers[state.globalDefault.providerId].model = state.globalDefault.modelId
    for (const config of Object.values(settings.providers)) config.apiKey = ''
    return settings
  }

  async setGlobalDefault(routeValue: unknown): Promise<PublicAiSettings> {
    const route = normalizeRoute(routeValue)
    if (!route || !PUBLIC_PROVIDER_IDS.includes(route.providerId as PublicAiProviderId)) {
      throw new Error('A supported provider and non-empty model are required')
    }
    if (route.providerId === 'genspark' && !this.options.isGensparkConfigured()) {
      throw new Error('Sign in to Genspark before selecting a Genspark model')
    } else if (route.providerId !== 'genspark') {
      const providerId = route.providerId as Exclude<PublicAiProviderId, 'genspark'>
      const provider = this.load().providers[providerId]
      const credentialStatus = this.options.secretStore.status(providerId)
      if (credentialStatus === 'unreadable') {
        throw new Error(`Re-enter your ${this.providerLabel(providerId)} API key in AI settings`)
      }
      if (credentialStatus === 'missing' || !provider?.verifiedAt) {
        throw new Error(`${this.providerLabel(providerId)} is not verified`)
      }
    }
    const catalog = await this.options.catalogs.list([route.providerId as PublicAiProviderId])
    if (
      !catalog.models.some(
        (model) => model.providerId === route.providerId && model.id === route.modelId,
      )
    ) {
      throw new Error(`${route.modelId} is not an available GenOffice-compatible model`)
    }
    const state = this.load()
    state.globalDefault = route
    this.write(state)
    return this.getPublicSettings()
  }

  async verifyAndSave(args: VerifyAndSaveAiProviderArgs): Promise<VerifyAndSaveAiProviderResult> {
    const providerId = args?.providerId
    if (!['openrouter', 'anthropic', 'openai'].includes(providerId)) {
      throw new Error('Provider does not support API-key verification')
    }
    if (typeof args.apiKey !== 'string' || !args.apiKey.trim() || args.apiKey.length > 16_384) {
      throw new Error('A valid API key is required')
    }
    const apiKey = args.apiKey.trim()
    const rawVerification = await verifyProviderApiKey(providerId, apiKey, {
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    })
    const verification = redactVerification(rawVerification, apiKey)
    if (!verification.ok) {
      return {
        verification,
        saved: false,
        compatibleModelCount: 0,
        settings: this.getPublicSettings(),
      }
    }

    this.options.secretStore.set(providerId, apiKey)
    const state = this.load()
    const providerState: PersistedProviderState = {
      verifiedAt: verification.verifiedAt,
      usable: false,
    }
    if (verification.details.label) providerState.accountLabel = verification.details.label
    state.providers[providerId] = providerState
    this.write(state)

    this.options.catalogs.clear(providerId)
    const catalogs = await this.options.catalogs.refresh([providerId])
    const providerCatalog = catalogs.catalogs.find((catalog) => catalog.providerId === providerId)
    const compatibleModelCount = catalogs.models.filter(
      (model) => model.providerId === providerId,
    ).length
    providerState.usable = compatibleModelCount > 0 && !providerCatalog?.error
    this.write(state)
    return {
      verification,
      saved: true,
      compatibleModelCount,
      settings: this.getPublicSettings(),
    }
  }

  removeProviderKey(providerId: unknown): PublicAiSettings {
    if (!['openrouter', 'anthropic', 'openai'].includes(String(providerId))) {
      throw new Error('Provider key cannot be removed')
    }
    const id = providerId as Exclude<PublicAiProviderId, 'genspark'>
    const state = this.load()
    if (state.globalDefault.providerId === id) {
      throw new Error(
        `Choose another global default before removing the ${this.providerLabel(id)} API key`,
      )
    }
    this.options.secretStore.remove(id)
    delete state.providers[id]
    this.write(state)
    this.options.catalogs.clear(id)
    return this.getPublicSettings()
  }

  async listModels(args: ListAiModelsArgs = {}): Promise<ListAiModelsResult> {
    const providerIds = this.configuredProviderIds()
    const result = this.redactCatalogResult(
      await this.options.catalogs.list(
        providerIds,
        { imageInput: args.requireImageInput === true },
        args.forceRefresh === true,
      ),
    )
    if (!args.requireImageInput) this.updateProviderUsability(result)
    return result
  }

  async refreshModels(args: RefreshAiModelsArgs = {}): Promise<ListAiModelsResult> {
    const configured = new Set(this.configuredProviderIds())
    const requested = args.providerIds?.length ? args.providerIds : [...configured]
    const providerIds = requested.filter((providerId) => configured.has(providerId))
    const result = this.redactCatalogResult(
      await this.options.catalogs.refresh(providerIds, {
        imageInput: args.requireImageInput === true,
      }),
    )
    if (!args.requireImageInput) this.updateProviderUsability(result)
    return result
  }

  getGlobalDefault(): AiRoute {
    return { ...this.load().globalDefault }
  }

  getProviderConfig(route: AiRoute, gensparkApiKey: () => string): AiProviderConfig {
    const provider = AI_PROVIDERS.find((candidate) => candidate.id === route.providerId)
    if (!provider) throw new Error(`Unknown AI provider: ${route.providerId}`)
    if (route.providerId === 'genspark') {
      const apiKey = gensparkApiKey()
      if (!apiKey) throw new Error('Not signed in to Genspark')
      return { apiKey, model: route.modelId }
    }
    if (this.options.secretStore.status(route.providerId) === 'unreadable') {
      throw new Error(`Re-enter your ${provider.label} API key in AI settings`)
    }
    const apiKey = this.options.secretStore.get(route.providerId)
    if (!apiKey) throw new Error(`No API key configured for ${provider.label}`)
    const baseUrl = this.load().providers[route.providerId]?.baseUrl ?? provider.defaultBaseUrl
    return { apiKey, model: route.modelId, ...(baseUrl ? { baseUrl } : {}) }
  }

  async assertRouteAvailable(
    route: AiRoute,
    requirements: { requireImageInput?: boolean } = {},
  ): Promise<void> {
    if (!PUBLIC_PROVIDER_IDS.includes(route.providerId as PublicAiProviderId)) {
      throw new Error(`${route.providerId} is not exposed as a selectable provider`)
    }
    if (route.providerId === 'genspark' && !this.options.isGensparkConfigured()) {
      throw new Error('Not signed in to Genspark')
    }
    if (route.providerId !== 'genspark') {
      const credentialStatus = this.options.secretStore.status(route.providerId)
      if (credentialStatus === 'unreadable') {
        throw new Error(
          `Re-enter your ${this.providerLabel(route.providerId)} API key in AI settings`,
        )
      }
      if (credentialStatus === 'missing') {
        throw new Error(`No API key configured for ${this.providerLabel(route.providerId)}`)
      }
    }
    const result = await this.options.catalogs.list([route.providerId as PublicAiProviderId])
    const model = result.models.find(
      (candidate) => candidate.providerId === route.providerId && candidate.id === route.modelId,
    )
    if (!model) {
      throw new Error(`${route.modelId} is unavailable; refresh models and choose a replacement`)
    }
    if (
      requirements.requireImageInput === true &&
      !model.capabilities.inputModalities.includes('image')
    ) {
      throw new Error(
        `${route.modelId} does not support image input; choose a vision-capable model`,
      )
    }
  }

  private configuredProviderIds(): PublicAiProviderId[] {
    const state = this.load()
    return PUBLIC_PROVIDER_IDS.filter((providerId) => {
      if (providerId === 'genspark') return this.options.isGensparkConfigured()
      return (
        this.options.secretStore.status(providerId) === 'ready' &&
        Boolean(state.providers[providerId]?.verifiedAt)
      )
    })
  }

  private publicProvider(
    providerId: PublicAiProviderId,
    state: PersistedAiSettings,
  ): PublicAiProvider {
    const providerState = state.providers[providerId]
    const definition = AI_PROVIDERS.find((candidate) => candidate.id === providerId)!
    if (providerId === 'genspark') {
      return {
        id: providerId,
        label: definition.label,
        status: this.options.isGensparkConfigured() ? 'connected' : 'unavailable',
        hasApiKey: false,
      }
    }
    const credentialStatus = this.options.secretStore.status(providerId)
    const hasApiKey = credentialStatus === 'ready'
    const provider: PublicAiProvider = {
      id: providerId,
      label: definition.label,
      status: !hasApiKey
        ? 'not-configured'
        : !providerState?.verifiedAt
          ? 'unverified'
          : providerState.usable === false
            ? 'unavailable'
            : 'connected',
      hasApiKey,
    }
    if (providerState?.verifiedAt) provider.verifiedAt = providerState.verifiedAt
    if (providerState?.accountLabel) provider.accountLabel = providerState.accountLabel
    return provider
  }

  private providerLabel(providerId: AiProviderId): string {
    return AI_PROVIDERS.find((provider) => provider.id === providerId)?.label ?? providerId
  }

  private load(): PersistedAiSettings {
    if (this.state) return this.state
    this.removeStaleLegacyBackup()
    if (!existsSync(this.options.settingsPath)) {
      this.state = { schemaVersion: 2, globalDefault: { ...DEFAULT_ROUTE }, providers: {} }
      return this.state
    }
    const rawText = readFileSync(this.options.settingsPath, 'utf8')
    let raw: unknown
    try {
      raw = JSON.parse(rawText)
    } catch {
      throw new Error('AI settings are unreadable')
    }
    const current = normalizePersistedSettings(raw)
    if (current) {
      this.state = current
      return current
    }
    return this.migrateLegacy(raw)
  }

  private migrateLegacy(raw: unknown): PersistedAiSettings {
    if (!isRecord(raw)) throw new Error('Unsupported AI settings format')
    const legacy = resolveAiSettings(
      raw as Partial<AiSettings> & LegacyAiSettings,
      defaultAiSettings(),
    )
    const providers: PersistedAiSettings['providers'] = {}
    for (const [id, configValue] of Object.entries(legacy.providers)) {
      if (!isProviderId(id) || !isRecord(configValue)) continue
      const apiKey = typeof configValue.apiKey === 'string' ? configValue.apiKey : ''
      const baseUrl = typeof configValue.baseUrl === 'string' ? configValue.baseUrl : ''
      if (apiKey) this.options.secretStore.set(id, apiKey)
      if (baseUrl) providers[id] = { baseUrl }
    }
    const selected = legacy.providers[legacy.provider]
    const globalDefault =
      selected?.model && isProviderId(legacy.provider)
        ? { providerId: legacy.provider, modelId: selected.model }
        : { ...DEFAULT_ROUTE }
    const migrated: PersistedAiSettings = { schemaVersion: 2, globalDefault, providers }
    // Validate the generated replacement before the atomic temp-file rename. The original
    // legacy file remains the rollback copy until rename succeeds, so no second plaintext
    // credential file is ever created.
    const validated = normalizePersistedSettings(JSON.parse(JSON.stringify(migrated)))
    if (!validated) throw new Error('Migrated AI settings could not be validated')
    this.write(validated)
    return validated
  }

  private removeStaleLegacyBackup(): void {
    const backupPath = `${this.options.settingsPath}.legacy-backup`
    if (!existsSync(backupPath)) return
    try {
      unlinkSync(backupPath)
    } catch {
      throw new Error('A plaintext legacy AI settings backup could not be removed')
    }
  }

  private redactCatalogResult(result: ListAiModelsResult): ListAiModelsResult {
    return {
      models: result.models,
      catalogs: result.catalogs.map((catalog) => {
        if (!catalog.error || catalog.providerId === 'genspark') return catalog
        let secret: string | null = null
        try {
          secret = this.options.secretStore.get(catalog.providerId)
        } catch {
          // The public error remains useful even when secure storage is temporarily unavailable.
        }
        return {
          ...catalog,
          error: redactProviderError(catalog.error, secret ? [secret] : []),
        }
      }),
    }
  }

  private updateProviderUsability(result: ListAiModelsResult): void {
    const state = this.load()
    let changed = false
    for (const catalog of result.catalogs) {
      if (catalog.providerId === 'genspark' || catalog.error) continue
      const provider = state.providers[catalog.providerId]
      if (!provider?.verifiedAt) continue
      const usable = result.models.some((model) => model.providerId === catalog.providerId)
      if (provider.usable !== usable) {
        provider.usable = usable
        changed = true
      }
    }
    if (changed) this.write(state)
  }

  private write(state: PersistedAiSettings): void {
    mkdirSync(dirname(this.options.settingsPath), { recursive: true })
    const tempPath = `${this.options.settingsPath}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tempPath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(tempPath, this.options.settingsPath)
    this.state = state
  }
}
