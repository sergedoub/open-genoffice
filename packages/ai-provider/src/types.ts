import type { AgentMessage, AgentToolCall, AgentToolDef } from '@genoffice/agent-core'

export type AiProviderId =
  'genspark' | 'openrouter' | 'anthropic' | 'gemini' | 'deepseek' | 'openai' | 'custom'

export type AiProviderProtocol = 'genspark' | 'anthropic' | 'gemini' | 'openai-compatible'

export type AiProviderAuth = 'genspark-login' | 'bearer-key' | 'anthropic-key' | 'gemini-key'

export type AiModelSource = 'static' | 'remote' | 'manual'

/** Provider behavior shared by settings, routing and catalog consumers. */
export interface AiProviderDefinition {
  id: AiProviderId
  label: string
  protocol: AiProviderProtocol
  auth: AiProviderAuth
  modelSource: AiModelSource
  defaultBaseUrl?: string
  defaultModel?: string
}

export type AiModelModality = 'text' | 'image' | 'file' | 'audio' | 'video' | 'embeddings'

export interface AiModelCapabilities {
  inputModalities: AiModelModality[]
  outputModalities: AiModelModality[]
  supportsTools: boolean
  contextWindow: number | null
  maxOutputTokens: number | null
}

/** Prices are USD-denominated values reported by the provider and may change at any time. */
export interface AiModelPricing {
  promptPerToken?: number
  completionPerToken?: number
  image?: number
  request?: number
}

/** Provider-neutral model metadata suitable for settings and model-picker clients. */
export interface AiModelSummary {
  id: string
  canonicalId: string
  providerId: AiProviderId
  name: string
  description?: string
  createdAt?: string
  expiresAt: string | null
  available: boolean
  capabilities: AiModelCapabilities
  pricing?: AiModelPricing
}

/** A concrete provider/model selection. Secrets deliberately do not belong in routes. */
export interface AiRoute {
  providerId: AiProviderId
  modelId: string
}

/** Genspark account status (gsk login state; the sole auth source for AI features) */
export interface GenSparkAccountStatus {
  loggedIn: boolean
  email?: string
}

export interface AiProviderConfig {
  apiKey: string
  model: string
  /** only used by the custom (OpenAI-compatible) provider */
  baseUrl?: string | undefined
}

export interface AiProviderMeta extends AiProviderDefinition {
  models: string[]
  defaultModel: string
  keyPlaceholder: string
  needsBaseUrl?: boolean
}

export interface AiSettings {
  provider: AiProviderId
  providers: Record<AiProviderId, AiProviderConfig>
}

/** pre-provider settings shape (single OpenAI-compatible endpoint); migrated into "custom" */
export interface LegacyAiSettings {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export interface AiChatRequest {
  settings: AiSettings
  system: string
  user: string
}

export interface AiChatResponse {
  ok: boolean
  content?: string
  error?: string
}

export interface AiStreamRequest {
  requestId: string
  settings: AiSettings
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
}

export interface AiStreamChunk {
  requestId: string
  type: 'delta' | 'tool-call' | 'done' | 'error'
  text?: string
  /** complete parsed tool call (emitted once its arguments finish streaming) */
  toolCall?: AgentToolCall
  error?: string
}
