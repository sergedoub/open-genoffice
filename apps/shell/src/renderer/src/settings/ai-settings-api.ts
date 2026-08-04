import type {
  AiRoute,
  ListAiModelsArgs,
  ListAiModelsResult,
  PublicAiProviderId,
  PublicAiSettings,
  RefreshAiModelsArgs,
  VerifyAndSaveAiProviderArgs,
  VerifyAndSaveAiProviderResult,
} from '../../../../../docs/src/shared/ipc'

export type KeyedAiProviderId = Exclude<PublicAiProviderId, 'genspark'>

/**
 * Minimal renderer contract for the Home settings surface. The shell preload
 * may expose these methods on its existing API; editor windows expose them on
 * `window.desktop`. No credential-reading method is part of this interface.
 */
export interface AiSettingsRendererApi {
  /** Start the existing Genspark browser login flow. */
  accountLogin?: () => Promise<boolean>
  getAiPublicSettings(): Promise<PublicAiSettings>
  setAiGlobalDefault(route: AiRoute): Promise<PublicAiSettings>
  verifyAndSaveAiProvider(args: VerifyAndSaveAiProviderArgs): Promise<VerifyAndSaveAiProviderResult>
  removeAiProviderKey(providerId: KeyedAiProviderId): Promise<PublicAiSettings>
  listAiModels(args?: ListAiModelsArgs): Promise<ListAiModelsResult>
  refreshAiModels(args?: RefreshAiModelsArgs): Promise<ListAiModelsResult>
}

function isAiSettingsRendererApi(value: unknown): value is AiSettingsRendererApi {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Record<keyof AiSettingsRendererApi, unknown>>
  return (
    typeof candidate.getAiPublicSettings === 'function' &&
    typeof candidate.setAiGlobalDefault === 'function' &&
    typeof candidate.verifyAndSaveAiProvider === 'function' &&
    typeof candidate.removeAiProviderKey === 'function' &&
    typeof candidate.listAiModels === 'function' &&
    typeof candidate.refreshAiModels === 'function'
  )
}

export function resolveAiSettingsApi(): AiSettingsRendererApi | null {
  const desktop = (window as unknown as { desktop?: unknown }).desktop
  if (isAiSettingsRendererApi(desktop)) return desktop
  if (isAiSettingsRendererApi(window.aiOffice)) return window.aiOffice
  return null
}
