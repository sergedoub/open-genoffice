import { ModelPicker, type ModelPickerModel } from '@genoffice/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  AiModelSummary,
  AiRoute,
  ListAiModelsResult,
  PublicAiProvider,
  PublicAiProviderId,
  PublicAiSettings,
} from '../../../../../docs/src/shared/ipc'
import type { AiSettingsRendererApi, KeyedAiProviderId } from './ai-settings-api'
import { shouldShowGensparkLogin } from './provider-card'
import { modelListNeedsRefresh } from './ai-settings-refresh'

interface AiSettingsModalProps {
  api: AiSettingsRendererApi | null
  onClose: () => void
}

const PROVIDER_ORDER: readonly PublicAiProviderId[] = [
  'genspark',
  'openrouter',
  'anthropic',
  'openai',
]

const PROVIDER_HELP: Record<PublicAiProviderId, string> = {
  genspark: 'Use your signed-in Genspark account and credits.',
  openrouter: 'Access compatible models from many providers with one key.',
  anthropic: 'Get your Anthropic key',
  openai: 'Get your OpenAI key',
}

const PROVIDER_KEY_LINKS: Partial<Record<PublicAiProviderId, string>> = {
  anthropic: 'https://platform.claude.com/settings/workspaces/default/keys',
  openai: 'https://platform.openai.com/api-keys',
}

const KEY_PLACEHOLDERS: Record<KeyedAiProviderId, string> = {
  openrouter: 'sk-or-v1-…',
  anthropic: 'sk-ant-…',
  openai: 'sk-…',
}

function providerLabel(providerId: string): string {
  switch (providerId) {
    case 'genspark':
      return 'Genspark'
    case 'openrouter':
      return 'OpenRouter'
    case 'anthropic':
      return 'Anthropic'
    case 'openai':
      return 'OpenAI'
    default:
      return providerId
  }
}

function statusLabel(provider: PublicAiProvider): string {
  switch (provider.status) {
    case 'connected':
      return 'Connected'
    case 'unverified':
      return 'Needs verification'
    case 'unavailable':
      return 'Unavailable'
    case 'not-configured':
      return provider.verifiedAt ? 'Reconnect required' : 'Not configured'
  }
}

function statusDetail(provider: PublicAiProvider): string | null {
  if (provider.accountLabel) return provider.accountLabel
  if (provider.verifiedAt) {
    const verified = new Date(provider.verifiedAt)
    if (!Number.isNaN(verified.getTime())) {
      return `Verified ${verified.toLocaleDateString()}`
    }
  }
  return null
}

function contextLabel(tokens: number | null): string | null {
  if (!tokens || tokens <= 0) return null
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M context`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K context`
  return `${tokens} context`
}

export function toModelPickerModel(model: AiModelSummary): ModelPickerModel {
  const capabilityLabels = [
    model.capabilities.inputModalities.includes('image') ? 'Images' : null,
    model.capabilities.supportsTools ? 'Tools' : null,
    contextLabel(model.capabilities.contextWindow),
  ].filter((label): label is string => label !== null)

  return {
    providerId: model.providerId,
    modelId: model.id,
    providerLabel: providerLabel(model.providerId),
    label: model.name,
    shortLabel: model.name,
    description: model.description,
    capabilityLabels,
    searchTerms: [model.id, model.canonicalId],
  }
}

const GENSPARK_BUNDLE_MODEL: ModelPickerModel = {
  providerId: 'genspark',
  modelId: 'claude-opus-4-7',
  providerLabel: 'Genspark',
  label: 'Genspark',
  shortLabel: 'Genspark',
  searchTerms: ['genspark', 'default bundle'],
}

export function toModelPickerModels(
  models: readonly AiModelSummary[],
  providers: readonly PublicAiProvider[],
): ModelPickerModel[] {
  const connectedProviders = new Set(
    providers.filter((provider) => provider.status === 'connected').map((provider) => provider.id),
  )
  const keyedProviderModels = models
    .filter(
      (model) =>
        model.providerId !== 'genspark' &&
        connectedProviders.has(model.providerId as PublicAiProviderId) &&
        model.available &&
        model.capabilities.inputModalities.includes('text') &&
        model.capabilities.outputModalities.includes('text') &&
        model.capabilities.supportsTools,
    )
    .map(toModelPickerModel)

  return [GENSPARK_BUNDLE_MODEL, ...keyedProviderModels]
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Something went wrong. Try again.'
}

function ProviderCard({
  provider,
  secureStorageAvailable,
  api,
  signInRequested = false,
  onSettingsChange,
  onModelsChange,
}: {
  provider: PublicAiProvider
  secureStorageAvailable: boolean
  api: AiSettingsRendererApi
  signInRequested?: boolean
  onSettingsChange: (settings: PublicAiSettings) => void
  onModelsChange: (models: ListAiModelsResult) => void
}) {
  const keyedProvider = provider.id === 'genspark' ? null : provider.id
  const [editing, setEditing] = useState(!provider.hasApiKey)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'verify' | 'remove' | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!provider.hasApiKey) setEditing(true)
  }, [provider.hasApiKey])

  const verifyAndSave = async () => {
    if (!keyedProvider || !key.trim() || busy) return
    setBusy('verify')
    setError(null)
    setMessage(null)
    try {
      const result = await api.verifyAndSaveAiProvider({
        providerId: keyedProvider,
        apiKey: key.trim(),
      })
      setKey('')
      onSettingsChange(result.settings)
      if (!result.verification.ok) {
        setError(result.verification.error.message)
        return
      }
      if (!result.saved) {
        setError('The key was verified but could not be saved.')
        return
      }
      setEditing(false)
      setMessage(
        `Verified. ${result.compatibleModelCount} compatible model${result.compatibleModelCount === 1 ? '' : 's'} found.`,
      )
      onModelsChange(await api.listAiModels())
    } catch (caught) {
      setKey('')
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!keyedProvider || busy) return
    setBusy('remove')
    setError(null)
    setMessage(null)
    try {
      onSettingsChange(await api.removeAiProviderKey(keyedProvider))
      setKey('')
      setEditing(true)
      onModelsChange(await api.listAiModels())
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(null)
    }
  }

  const login = async () => {
    if (!api.accountLogin || loginBusy) return
    setLoginBusy(true)
    setError(null)
    try {
      await api.accountLogin()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoginBusy(false)
    }
  }

  const showGensparkLogin = shouldShowGensparkLogin(provider, api.accountLogin !== undefined)

  return (
    <section className="ai-provider-card" aria-labelledby={`ai-provider-${provider.id}`}>
      <div className="ai-provider-card__head">
        <div>
          <h3 id={`ai-provider-${provider.id}`}>{provider.label}</h3>
          <p>
            {PROVIDER_KEY_LINKS[provider.id] ? (
              <a href={PROVIDER_KEY_LINKS[provider.id]} target="_blank" rel="noreferrer">
                {PROVIDER_HELP[provider.id]}
              </a>
            ) : (
              PROVIDER_HELP[provider.id]
            )}
          </p>
        </div>
        {showGensparkLogin ? (
          <button
            type="button"
            className="ai-settings-btn ai-settings-btn--primary"
            data-genspark-sign-in
            disabled={loginBusy}
            onClick={() => void login()}
          >
            {loginBusy ? 'Opening sign-in…' : 'Sign in to Genspark'}
          </button>
        ) : (
          <span className={`ai-provider-status ai-provider-status--${provider.status}`}>
            <span aria-hidden="true" />
            {statusLabel(provider)}
          </span>
        )}
      </div>

      {statusDetail(provider) && (
        <p className="ai-provider-card__detail">{statusDetail(provider)}</p>
      )}

      {keyedProvider && editing && (
        <div className="ai-provider-key-row">
          <label>
            <span className="sr-only">{provider.label} API key</span>
            <input
              type="password"
              value={key}
              autoComplete="off"
              spellCheck={false}
              placeholder={KEY_PLACEHOLDERS[keyedProvider]}
              disabled={!secureStorageAvailable || busy !== null}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void verifyAndSave()
              }}
            />
          </label>
          <button
            type="button"
            className="ai-settings-btn ai-settings-btn--primary"
            disabled={!secureStorageAvailable || !key.trim() || busy !== null}
            onClick={() => void verifyAndSave()}
          >
            {busy === 'verify' ? 'Verifying…' : 'Verify & save'}
          </button>
          {provider.hasApiKey && (
            <button
              type="button"
              className="ai-settings-btn ai-settings-btn--quiet"
              disabled={busy !== null}
              onClick={() => {
                setEditing(false)
                setKey('')
                setError(null)
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {keyedProvider && !provider.hasApiKey && provider.verifiedAt && (
        <p className="ai-provider-message ai-provider-message--notice" role="status">
          The stored credential can no longer be unlocked. Enter the API key again to reconnect.
        </p>
      )}

      {keyedProvider && provider.hasApiKey && !editing && (
        <div className="ai-provider-actions">
          <span className="ai-provider-saved-key" aria-label="Stored API key">
            ••••••••••••
          </span>
          <button
            type="button"
            className="ai-settings-btn ai-settings-btn--secondary"
            disabled={busy !== null}
            onClick={() => {
              setEditing(true)
              setMessage(null)
              setError(null)
            }}
          >
            Replace
          </button>
          <button
            type="button"
            className="ai-settings-btn ai-settings-btn--danger"
            disabled={busy !== null}
            onClick={() => void remove()}
          >
            {busy === 'remove' ? 'Removing…' : 'Remove'}
          </button>
        </div>
      )}

      {message && <p className="ai-provider-message ai-provider-message--success">{message}</p>}
      {showGensparkLogin && signInRequested && (
        <p className="ai-provider-message ai-provider-message--notice" role="status">
          Sign in to Genspark to use it as your default model.
        </p>
      )}
      {error && (
        <p className="ai-provider-message ai-provider-message--error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

export function AiSettingsModal({ api, onClose }: AiSettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [settings, setSettings] = useState<PublicAiSettings | null>(null)
  const [modelResult, setModelResult] = useState<ListAiModelsResult | null>(null)
  const [loading, setLoading] = useState(api !== null)
  const [refreshing, setRefreshing] = useState(false)
  const [savingDefault, setSavingDefault] = useState(false)
  const [gensparkSignInRequested, setGensparkSignInRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastModelsRefreshAtRef = useRef(0)
  const modelsRefreshPromiseRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => dialogRef.current?.focus())
    return () => returnFocusRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!api) return
    let active = true
    setLoading(true)
    setError(null)
    void Promise.all([api.getAiPublicSettings(), api.listAiModels()])
      .then(([nextSettings, nextModels]) => {
        if (!active) return
        setSettings(nextSettings)
        setModelResult(nextModels)
        lastModelsRefreshAtRef.current = nextModels.catalogs.some(
          (catalog) => catalog.stale || catalog.error,
        )
          ? 0
          : Date.now()
      })
      .catch((caught: unknown) => {
        if (active) setError(errorMessage(caught))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api])

  const providers = useMemo(() => {
    if (!settings) return []
    const byId = new Map(settings.providers.map((provider) => [provider.id, provider]))
    return PROVIDER_ORDER.map(
      (providerId): PublicAiProvider =>
        byId.get(providerId) ?? {
          id: providerId,
          label: providerLabel(providerId),
          status: 'unavailable',
          hasApiKey: false,
        },
    )
  }, [settings])

  const pickerModels = useMemo(() => {
    return toModelPickerModels(modelResult?.models ?? [], providers)
  }, [modelResult, providers])

  const gensparkSignedIn = providers.some(
    (provider) => provider.id === 'genspark' && provider.status === 'connected',
  )

  useEffect(() => {
    if (gensparkSignedIn) setGensparkSignInRequested(false)
  }, [gensparkSignedIn])

  const refreshModelsIfStale = () => {
    if (
      !api ||
      refreshing ||
      modelsRefreshPromiseRef.current ||
      !modelListNeedsRefresh(modelResult, lastModelsRefreshAtRef.current)
    ) {
      return
    }

    const refreshPromise = (async () => {
      setRefreshing(true)
      setError(null)
      try {
        const nextModels = await api.refreshAiModels()
        setModelResult(nextModels)
        lastModelsRefreshAtRef.current = nextModels.catalogs.some(
          (catalog) => catalog.stale || catalog.error,
        )
          ? 0
          : Date.now()
      } catch (caught) {
        setError(errorMessage(caught))
      } finally {
        setRefreshing(false)
      }
    })()
    modelsRefreshPromiseRef.current = refreshPromise
    void refreshPromise.finally(() => {
      if (modelsRefreshPromiseRef.current === refreshPromise) {
        modelsRefreshPromiseRef.current = null
      }
    })
  }

  const setDefault = async (route: AiRoute) => {
    if (!api || savingDefault) return
    setSavingDefault(true)
    setError(null)
    try {
      setSettings(await api.setAiGlobalDefault(route))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSavingDefault(false)
    }
  }

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="ai-settings-overlay" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="ai-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-settings-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ai-settings-header">
          <div>
            <h2 id="ai-settings-title">AI settings</h2>
          </div>
          <button
            type="button"
            className="ai-settings-close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                d="M4 4l10 10M14 4 4 14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="ai-settings-body">
          {!api && (
            <div className="ai-settings-callout ai-settings-callout--error" role="alert">
              AI settings are unavailable in this build. Restart after installing the
              provider-enabled build.
            </div>
          )}

          {loading && (
            <div className="ai-settings-loading" role="status">
              Loading AI settings…
            </div>
          )}

          {error && (
            <div className="ai-settings-callout ai-settings-callout--error" role="alert">
              {error}
            </div>
          )}

          {settings && !settings.secureStorageAvailable && (
            <div className="ai-settings-callout ai-settings-callout--warning" role="alert">
              Secure credential storage is unavailable. API keys cannot be added on this device.
            </div>
          )}

          {settings && (
            <>
              <section className="ai-default-section" aria-labelledby="ai-default-title">
                <div className="ai-default-section__copy">
                  <h3 id="ai-default-title">Default model</h3>
                </div>
                <div className="ai-default-section__control">
                  <ModelPicker
                    models={pickerModels}
                    selection={settings.globalDefault}
                    busy={savingDefault}
                    placement="bottom"
                    matchTriggerWidth
                    onOpen={refreshModelsIfStale}
                    ariaLabel="Default model for new documents"
                    placeholder="Choose a compatible model"
                    searchPlaceholder="Search compatible models"
                    emptyLabel="No compatible models"
                    onSelectionChange={(model) => {
                      if (model.providerId === 'genspark') {
                        if (!gensparkSignedIn) {
                          setError(null)
                          setGensparkSignInRequested(true)
                          requestAnimationFrame(() => {
                            requestAnimationFrame(() => {
                              const signInButton =
                                dialogRef.current?.querySelector<HTMLButtonElement>(
                                  '[data-genspark-sign-in]',
                                )
                              signInButton?.scrollIntoView?.({ block: 'nearest' })
                              signInButton?.focus()
                            })
                          })
                          return
                        }
                        setGensparkSignInRequested(false)
                        void setDefault({ providerId: 'genspark', modelId: model.modelId })
                        return
                      }
                      setGensparkSignInRequested(false)
                      const selected = modelResult?.models.find(
                        (candidate) =>
                          candidate.providerId === model.providerId &&
                          candidate.id === model.modelId,
                      )
                      if (selected) {
                        void setDefault({ providerId: selected.providerId, modelId: selected.id })
                      }
                    }}
                  />
                </div>
              </section>

              <section className="ai-providers-section" aria-labelledby="ai-providers-title">
                <div className="ai-providers-section__head">
                  <h3 id="ai-providers-title">Providers</h3>
                  <p>Keys are encrypted on this device. Stored keys are never displayed again.</p>
                </div>
                <div className="ai-provider-grid">
                  {providers.map((provider) => (
                    <ProviderCard
                      key={provider.id}
                      provider={provider}
                      secureStorageAvailable={settings.secureStorageAvailable}
                      api={api!}
                      signInRequested={provider.id === 'genspark' && gensparkSignInRequested}
                      onSettingsChange={setSettings}
                      onModelsChange={setModelResult}
                    />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
