import { httpBodyDetail } from './http-error'
import { OPENROUTER_API_BASE_URL } from './providers'
import type { AiProviderId } from './types'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type VerifiableAiProviderId = Extract<AiProviderId, 'openrouter' | 'anthropic' | 'openai'>

export type AiProviderVerificationErrorCode =
  | 'missing-key'
  | 'invalid-key'
  | 'forbidden'
  | 'rate-limited'
  | 'provider-error'
  | 'network-error'
  | 'invalid-response'

export interface AiProviderVerificationError {
  code: AiProviderVerificationErrorCode
  message: string
  status?: number
}

export interface AiProviderVerificationDetails {
  label?: string
  expiresAt?: string | null
  limit?: number | null
  limitRemaining?: number | null
  /** Model-list verification endpoints expose accessible IDs without generating tokens. */
  modelIds?: string[]
}

export type AiProviderVerificationResult =
  | {
      ok: true
      providerId: VerifiableAiProviderId
      verifiedAt: string
      details: AiProviderVerificationDetails
    }
  | {
      ok: false
      providerId: VerifiableAiProviderId
      verifiedAt: string
      error: AiProviderVerificationError
    }

export interface VerifyApiKeyOptions {
  fetch?: FetchLike
  signal?: AbortSignal
  now?: Date
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function redactSecret(value: string, secret: string): string {
  return secret ? value.split(secret).join('[REDACTED]') : value
}

function errorCode(status: number): AiProviderVerificationErrorCode {
  if (status === 401) return 'invalid-key'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate-limited'
  return 'provider-error'
}

function failure(
  providerId: VerifiableAiProviderId,
  verifiedAt: string,
  code: AiProviderVerificationErrorCode,
  message: string,
  status?: number,
): AiProviderVerificationResult {
  const error: AiProviderVerificationError = { code, message }
  if (status !== undefined) error.status = status
  return { ok: false, providerId, verifiedAt, error }
}

async function responseFailure(
  providerId: VerifiableAiProviderId,
  verifiedAt: string,
  response: Response,
  apiKey: string,
): Promise<AiProviderVerificationResult> {
  return failure(
    providerId,
    verifiedAt,
    errorCode(response.status),
    `${providerId} verification HTTP ${response.status}: ${redactSecret(
      httpBodyDetail(await response.text()),
      apiKey,
    )}`,
    response.status,
  )
}

function modelIds(payload: unknown): string[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null
  return payload.data.flatMap((model) =>
    isRecord(model) && typeof model.id === 'string' && model.id ? [model.id] : [],
  )
}

async function request(
  providerId: VerifiableAiProviderId,
  apiKey: string,
  url: string,
  init: RequestInit,
  options: VerifyApiKeyOptions,
): Promise<{ response: Response; verifiedAt: string } | AiProviderVerificationResult> {
  const verifiedAt = (options.now ?? new Date()).toISOString()
  if (!apiKey.trim()) {
    return failure(providerId, verifiedAt, 'missing-key', `A ${providerId} API key is required`)
  }
  try {
    const requestInit: RequestInit = { ...init }
    if (options.signal) requestInit.signal = options.signal
    const response = await (options.fetch ?? fetch)(url, requestInit)
    if (!response.ok) return responseFailure(providerId, verifiedAt, response, apiKey)
    return { response, verifiedAt }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return failure(
      providerId,
      verifiedAt,
      'network-error',
      `${providerId} verification failed: ${redactSecret(message, apiKey)}`,
    )
  }
}

export async function verifyOpenRouterApiKey(
  apiKey: string,
  options: VerifyApiKeyOptions = {},
): Promise<AiProviderVerificationResult> {
  const requested = await request(
    'openrouter',
    apiKey,
    `${OPENROUTER_API_BASE_URL}/key`,
    { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
    options,
  )
  if ('ok' in requested) return requested

  let payload: unknown
  try {
    payload = await requested.response.json()
  } catch {
    return failure(
      'openrouter',
      requested.verifiedAt,
      'invalid-response',
      'OpenRouter verification returned invalid JSON',
    )
  }
  if (!isRecord(payload) || !isRecord(payload.data)) {
    return failure(
      'openrouter',
      requested.verifiedAt,
      'invalid-response',
      'OpenRouter verification returned an invalid response',
    )
  }
  const data = payload.data
  const details: AiProviderVerificationDetails = {}
  if (typeof data.label === 'string' && data.label) details.label = data.label
  if (data.expires_at === null || typeof data.expires_at === 'string') {
    details.expiresAt = data.expires_at
  }
  const limit = finiteNumber(data.limit)
  const limitRemaining = finiteNumber(data.limit_remaining)
  if (limit !== undefined) details.limit = limit
  if (limitRemaining !== undefined) details.limitRemaining = limitRemaining
  return { ok: true, providerId: 'openrouter', verifiedAt: requested.verifiedAt, details }
}

export async function verifyAnthropicApiKey(
  apiKey: string,
  options: VerifyApiKeyOptions = {},
): Promise<AiProviderVerificationResult> {
  const requested = await request(
    'anthropic',
    apiKey,
    'https://api.anthropic.com/v1/models?limit=1',
    {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    },
    options,
  )
  if ('ok' in requested) return requested

  let payload: unknown
  try {
    payload = await requested.response.json()
  } catch {
    return failure(
      'anthropic',
      requested.verifiedAt,
      'invalid-response',
      'Anthropic verification returned invalid JSON',
    )
  }
  const ids = modelIds(payload)
  if (ids === null) {
    return failure(
      'anthropic',
      requested.verifiedAt,
      'invalid-response',
      'Anthropic verification returned an invalid response',
    )
  }
  return {
    ok: true,
    providerId: 'anthropic',
    verifiedAt: requested.verifiedAt,
    details: { modelIds: ids },
  }
}

export async function verifyOpenAiApiKey(
  apiKey: string,
  options: VerifyApiKeyOptions = {},
): Promise<AiProviderVerificationResult> {
  const requested = await request(
    'openai',
    apiKey,
    'https://api.openai.com/v1/models',
    { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } },
    options,
  )
  if ('ok' in requested) return requested

  let payload: unknown
  try {
    payload = await requested.response.json()
  } catch {
    return failure(
      'openai',
      requested.verifiedAt,
      'invalid-response',
      'OpenAI verification returned invalid JSON',
    )
  }
  const ids = modelIds(payload)
  if (ids === null) {
    return failure(
      'openai',
      requested.verifiedAt,
      'invalid-response',
      'OpenAI verification returned an invalid response',
    )
  }
  return {
    ok: true,
    providerId: 'openai',
    verifiedAt: requested.verifiedAt,
    details: { modelIds: ids },
  }
}

export function verifyProviderApiKey(
  providerId: VerifiableAiProviderId,
  apiKey: string,
  options: VerifyApiKeyOptions = {},
): Promise<AiProviderVerificationResult> {
  switch (providerId) {
    case 'openrouter':
      return verifyOpenRouterApiKey(apiKey, options)
    case 'anthropic':
      return verifyAnthropicApiKey(apiKey, options)
    case 'openai':
      return verifyOpenAiApiKey(apiKey, options)
  }
}
