export type {
  AiChatRequest,
  AiChatResponse,
  AiModelCapabilities,
  AiModelModality,
  AiModelPricing,
  AiModelSource,
  AiModelSummary,
  AiProviderConfig,
  AiProviderAuth,
  AiProviderDefinition,
  AiProviderId,
  AiProviderMeta,
  AiProviderProtocol,
  AiRoute,
  AiSettings,
  AiStreamChunk,
  AiStreamRequest,
  GenSparkAccountStatus,
  LegacyAiSettings,
} from './types'
export {
  AI_PROVIDERS,
  GENSPARK_LLM_BASE_URLS,
  OPENROUTER_API_BASE_URL,
  defaultAiSettings,
  resolveAiSettings,
} from './providers'
export {
  fetchOpenRouterModelCatalog,
  filterCompatibleModels,
  isAiModelCompatible,
  normalizeOpenRouterModels,
} from './catalog'
export type {
  AiModelCatalog,
  AiModelCompatibilityRequirements,
  OpenRouterCatalogOptions,
} from './catalog'
export {
  verifyAnthropicApiKey,
  verifyOpenAiApiKey,
  verifyOpenRouterApiKey,
  verifyProviderApiKey,
} from './verification'
export {
  OPENROUTER_AUTO_MODEL_ID,
  OPENROUTER_FREE_MODEL_ID,
  isFreeModel,
  isFreeModelId,
  openRouterRetryRoute,
  openRouterRetrySuggestion,
} from './retry'
export type {
  AiProviderVerificationDetails,
  AiProviderVerificationError,
  AiProviderVerificationErrorCode,
  AiProviderVerificationResult,
  VerifiableAiProviderId,
  VerifyApiKeyOptions,
} from './verification'
export { chatForProvider } from './chat'
export { sseLines, streamForProvider } from './stream'
export type { StreamCallbacks } from './stream'
