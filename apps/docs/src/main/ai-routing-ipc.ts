import {
  chatForProvider,
  streamForProvider,
  type AiChatResponse,
  type AiProviderConfig,
  type AiRoute,
  type AiStreamChunk,
} from '@genoffice/ai-provider'
import type {
  AppendChatArgs,
  ProjectStore,
  RebindChatArgs,
  ResolveChatArgs,
} from '@genoffice/project-store'
import { isAbsolute, normalize } from 'node:path'
import { AI_CHANNELS, type AiConversationIdentity, type AiStreamRequest } from '../shared/ipc'
import { redactProviderError } from './ai-secret-store'
import type { AiSettingsService } from './ai-settings-service'

interface IpcSenderLike {
  id: number
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

interface IpcEventLike {
  sender: IpcSenderLike
}

interface IpcMainLike {
  handle(channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown): void
}

export interface RegisterAiRoutingIpcOptions {
  ipcMain: IpcMainLike
  settings: AiSettingsService
  getProjectStore(): Pick<ProjectStore, 'getOrCreateChatAiMetadata' | 'setChatAiRoute'>
  getGensparkApiKey(): string
}

interface ActiveStream {
  controller: AbortController
  senderId: number
}

const activeStreams = new Map<string, ActiveStream>()
const MAX_SYSTEM_CHARS = 1_000_000
const MAX_USER_CHARS = 1_000_000
const MAX_MESSAGES = 500
const MAX_TOOLS = 50
const MAX_REQUEST_ID = 200
const MAX_IMAGES_PER_MESSAGE = 10
const MAX_IMAGES_TOTAL = 20
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_BYTES_TOTAL = 20 * 1024 * 1024
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_PROJECT_NAME = 200
const MAX_FILE_PATH = 4096
const MAX_CHAT_TEXT = 1_000_000
const MAX_CHAT_TOOLS = 50
const MAX_CHAT_ATTACHMENTS = 20
const MAX_TOOL_FIELD = 16_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys)
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) throw new Error(`${label} contains unsupported field: ${unexpected}`)
}

function boundedString(value: unknown, name: string, max: number, allowEmpty = true): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > max) {
    throw new Error(`${name} is invalid`)
  }
  return value
}

export function parseProjectId(value: unknown): string {
  const projectId = boundedString(value, 'projectId', 64, false)
  if (projectId !== 'default' && !/^proj-[a-f0-9]{12}$/.test(projectId)) {
    throw new Error('projectId is invalid')
  }
  return projectId
}

export function parseChatId(value: unknown, name = 'chatId'): string {
  const chatId = boundedString(value, name, 160, false)
  if (!/^(?:[a-f0-9]{16}|unsaved-[A-Za-z0-9_-]{1,128})$/.test(chatId)) {
    throw new Error(`${name} is invalid`)
  }
  return chatId
}

function parseSessionId(value: unknown): string {
  const sessionId = boundedString(value, 'sessionId', 128, false)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId)) {
    throw new Error('sessionId is invalid')
  }
  return sessionId
}

function parseAbsoluteFilePath(value: unknown, name = 'filePath'): string {
  const filePath = boundedString(value, name, MAX_FILE_PATH, false)
  if (filePath.includes('\0') || !isAbsolute(filePath) || normalize(filePath) !== filePath) {
    throw new Error(`${name} is invalid`)
  }
  return filePath
}

function parsePositiveInteger(value: unknown, name: string, max: number): number {
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > max) {
    throw new Error(`${name} is invalid`)
  }
  return Number(value)
}

function parseProjectName(value: unknown): string {
  const name = boundedString(value, 'Project name', MAX_PROJECT_NAME, false).trim()
  const containsControlCharacter = [...name].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (!name || containsControlCharacter) throw new Error('Project name is invalid')
  return name
}

export function parseProjectResolveArgs(value: unknown): ResolveChatArgs {
  if (!isRecord(value)) throw new Error('Project resolve request is required')
  assertOnlyKeys(value, ['filePath', 'tempChatId', 'sessionId'], 'Project resolve request')
  let filePath: string | null
  if (value.filePath !== null && value.filePath !== undefined) {
    filePath = parseAbsoluteFilePath(value.filePath)
  } else if (value.filePath !== null) {
    throw new Error('filePath must be an absolute path or null')
  } else {
    filePath = null
  }
  const result: ResolveChatArgs = { filePath }
  if (value.tempChatId !== undefined)
    result.tempChatId = parseChatId(value.tempChatId, 'tempChatId')
  if (value.sessionId !== undefined) result.sessionId = parseSessionId(value.sessionId)
  return result
}

function parseProjectRoute(
  value: unknown,
  label: string,
): { providerId: 'genspark' | 'openrouter' | 'anthropic' | 'openai'; modelId: string } {
  if (!isRecord(value)) throw new Error(`${label} is invalid`)
  assertOnlyKeys(value, ['providerId', 'modelId'], label)
  const providerId = boundedString(value.providerId, `${label} providerId`, 64, false)
  if (!['genspark', 'openrouter', 'anthropic', 'openai'].includes(providerId)) {
    throw new Error('Unsupported AI provenance provider')
  }
  return {
    providerId: providerId as 'genspark' | 'openrouter' | 'anthropic' | 'openai',
    modelId: boundedString(value.modelId, `${label} modelId`, 512, false),
  }
}

function parseChatTools(value: unknown): NonNullable<AppendChatArgs['tools']> {
  if (!Array.isArray(value) || value.length > MAX_CHAT_TOOLS) {
    throw new Error('Project chat tools are invalid')
  }
  return value.map((tool) => {
    if (!isRecord(tool)) throw new Error('Project chat tool is invalid')
    assertOnlyKeys(tool, ['name', 'summary', 'isError', 'input', 'output'], 'Project chat tool')
    const parsed: NonNullable<AppendChatArgs['tools']>[number] = {
      name: boundedString(tool.name, 'Tool name', 256),
      summary: boundedString(tool.summary, 'Tool summary', 4096),
    }
    if (tool.isError !== undefined) {
      if (typeof tool.isError !== 'boolean') throw new Error('Tool isError must be a boolean')
      parsed.isError = tool.isError
    }
    if (tool.input !== undefined)
      parsed.input = boundedString(tool.input, 'Tool input', MAX_TOOL_FIELD)
    if (tool.output !== undefined)
      parsed.output = boundedString(tool.output, 'Tool output', MAX_TOOL_FIELD)
    return parsed
  })
}

function parseChatAttachments(value: unknown): NonNullable<AppendChatArgs['attachments']> {
  if (!Array.isArray(value) || value.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error('Project chat attachments are invalid')
  }
  return value.map((attachment) => {
    if (!isRecord(attachment)) throw new Error('Project chat attachment is invalid')
    assertOnlyKeys(attachment, ['name', 'path', 'ext', 'sizeBytes'], 'Project chat attachment')
    const parsed: NonNullable<AppendChatArgs['attachments']>[number] = {
      name: boundedString(attachment.name, 'Attachment name', 1024, false),
    }
    if (attachment.path !== undefined)
      parsed.path = parseAbsoluteFilePath(attachment.path, 'Attachment path')
    if (attachment.ext !== undefined) {
      const ext = boundedString(attachment.ext, 'Attachment extension', 32)
      if (ext && !/^[a-z0-9]{1,32}$/.test(ext)) throw new Error('Attachment extension is invalid')
      parsed.ext = ext
    }
    if (attachment.sizeBytes !== undefined) {
      if (
        !Number.isSafeInteger(attachment.sizeBytes) ||
        Number(attachment.sizeBytes) < 0 ||
        Number(attachment.sizeBytes) > 1024 * 1024 * 1024
      ) {
        throw new Error('Attachment size is invalid')
      }
      parsed.sizeBytes = Number(attachment.sizeBytes)
    }
    return parsed
  })
}

export function parseProjectAppendArgs(value: unknown): AppendChatArgs {
  if (!isRecord(value)) throw new Error('Project append request is required')
  assertOnlyKeys(
    value,
    ['projectId', 'chatId', 'role', 'text', 'tools', 'attachments', 'ai'],
    'Project append request',
  )
  if (value.role !== 'user' && value.role !== 'assistant')
    throw new Error('Project chat role is invalid')
  const result: AppendChatArgs = {
    projectId: parseProjectId(value.projectId),
    chatId: parseChatId(value.chatId),
    role: value.role,
    text: boundedString(value.text, 'Project chat text', MAX_CHAT_TEXT),
  }
  if (value.tools !== undefined) result.tools = parseChatTools(value.tools)
  if (value.attachments !== undefined) result.attachments = parseChatAttachments(value.attachments)
  if (value.ai !== undefined) {
    if (value.role !== 'assistant' || !isRecord(value.ai))
      throw new Error('AI provenance is invalid')
    assertOnlyKeys(value.ai, ['requested', 'resolved'], 'AI provenance')
    result.ai = {
      requested: parseProjectRoute(value.ai.requested, 'Requested AI route'),
      ...(value.ai.resolved !== undefined
        ? { resolved: parseProjectRoute(value.ai.resolved, 'Resolved AI route') }
        : {}),
    }
  }
  return result
}

export function parseProjectLoadArgs(value: unknown): {
  projectId: string
  chatId: string
  limit: number
} {
  if (!isRecord(value)) throw new Error('Project load request is required')
  assertOnlyKeys(value, ['projectId', 'chatId', 'limit'], 'Project load request')
  return {
    projectId: parseProjectId(value.projectId),
    chatId: parseChatId(value.chatId),
    limit: value.limit === undefined ? 200 : parsePositiveInteger(value.limit, 'limit', 1000),
  }
}

export function parseProjectRebindArgs(value: unknown): RebindChatArgs {
  if (!isRecord(value)) throw new Error('Project rebind request is required')
  assertOnlyKeys(
    value,
    ['projectId', 'tempChatId', 'newChatId', 'newFilePath', 'sessionId'],
    'Project rebind request',
  )
  const destinations = [value.newChatId, value.newFilePath, value.sessionId].filter(
    (item) => item !== undefined,
  )
  if (destinations.length !== 1) throw new Error('Project rebind requires exactly one destination')
  const result: RebindChatArgs = {
    projectId: parseProjectId(value.projectId),
    tempChatId: parseChatId(value.tempChatId, 'tempChatId'),
  }
  if (value.newChatId !== undefined) result.newChatId = parseChatId(value.newChatId, 'newChatId')
  if (value.newFilePath !== undefined)
    result.newFilePath = parseAbsoluteFilePath(value.newFilePath, 'newFilePath')
  if (value.sessionId !== undefined) result.sessionId = parseSessionId(value.sessionId)
  return result
}

export function parseProjectSimpleArgs(
  kind: 'files' | 'create' | 'rename' | 'delete' | 'moveFile' | 'timeline',
  value: unknown,
): Record<string, string | number> {
  if (!isRecord(value)) throw new Error(`Project ${kind} request is required`)
  if (kind === 'files') {
    assertOnlyKeys(value, ['projectId'], 'Project files request')
    return { projectId: parseProjectId(value.projectId) }
  }
  if (kind === 'create') {
    assertOnlyKeys(value, ['name'], 'Project create request')
    return { name: parseProjectName(value.name) }
  }
  if (kind === 'rename') {
    assertOnlyKeys(value, ['id', 'name'], 'Project rename request')
    return { id: parseProjectId(value.id), name: parseProjectName(value.name) }
  }
  if (kind === 'delete') {
    assertOnlyKeys(value, ['id'], 'Project delete request')
    return { id: parseProjectId(value.id) }
  }
  if (kind === 'moveFile') {
    assertOnlyKeys(value, ['filePath', 'projectId'], 'Project move-file request')
    return {
      filePath: parseAbsoluteFilePath(value.filePath),
      projectId: parseProjectId(value.projectId),
    }
  }
  assertOnlyKeys(value, ['projectId', 'limit'], 'Project timeline request')
  return {
    projectId: parseProjectId(value.projectId),
    limit: value.limit === undefined ? 20 : parsePositiveInteger(value.limit, 'limit', 500),
  }
}

function parseIdentity(value: unknown): AiConversationIdentity {
  if (!isRecord(value)) throw new Error('Conversation identity is required')
  assertOnlyKeys(value, ['projectId', 'chatId'], 'Conversation identity')
  const projectId = parseProjectId(value.projectId)
  const chatId = parseChatId(value.chatId)
  return { projectId, chatId }
}

function parseOptionalIdentity(value: unknown): AiConversationIdentity | undefined {
  return value === undefined ? undefined : parseIdentity(value)
}

function parseRoute(value: unknown): AiRoute {
  if (!isRecord(value)) throw new Error('AI route is required')
  assertOnlyKeys(value, ['providerId', 'modelId'], 'AI route')
  const providerId = boundedString(value.providerId, 'providerId', 64, false)
  if (!['genspark', 'openrouter', 'anthropic', 'openai'].includes(providerId)) {
    throw new Error('AI route provider is not supported')
  }
  return {
    providerId: providerId as AiRoute['providerId'],
    modelId: boundedString(value.modelId, 'modelId', 512, false),
  }
}

function isStrictBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) return false
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  const contentLength = value.length - padding
  for (let index = 0; index < contentLength; index += 1) {
    const code = value.charCodeAt(index)
    const valid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47
    if (!valid) return false
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false
  }
  return true
}

function parseImage(value: unknown): { base64: string; mime: string; bytes: number } {
  if (!isRecord(value)) throw new Error('AI image is invalid')
  assertOnlyKeys(value, ['base64', 'mime'], 'AI image')
  const mime = boundedString(value.mime, 'AI image MIME type', 64, false).toLowerCase()
  if (!ALLOWED_IMAGE_MIME.has(mime)) throw new Error('AI image MIME type is not supported')
  const base64 = boundedString(
    value.base64,
    'AI image base64',
    Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4,
    false,
  )
  if (!isStrictBase64(base64)) {
    throw new Error('AI image base64 is invalid')
  }
  const bytes = Buffer.byteLength(base64, 'base64')
  if (bytes <= 0 || bytes > MAX_IMAGE_BYTES) throw new Error('AI image exceeds the size limit')
  return { base64, mime, bytes }
}

function boundedJsonRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} is invalid`)
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    throw new Error(`${name} is invalid`)
  }
  if (encoded.length > MAX_USER_CHARS) throw new Error(`${name} is too large`)
  return value
}

function parseMessages(value: unknown): AiStreamRequest['messages'] {
  if (!Array.isArray(value) || value.length > MAX_MESSAGES)
    throw new Error('AI messages are invalid')
  const messages: AiStreamRequest['messages'] = []
  let totalImageBytes = 0
  let totalImages = 0
  for (const message of value) {
    if (!isRecord(message) || !['user', 'assistant', 'tool'].includes(String(message.role))) {
      throw new Error('AI message is invalid')
    }
    if (message.role === 'user') {
      assertOnlyKeys(message, ['role', 'text', 'images'], 'AI user message')
      const parsed: AiStreamRequest['messages'][number] = {
        role: 'user',
        text: boundedString(message.text, 'AI message text', MAX_USER_CHARS),
      }
      if (message.images !== undefined) {
        if (!Array.isArray(message.images) || message.images.length > MAX_IMAGES_PER_MESSAGE) {
          throw new Error('AI images are invalid')
        }
        const images = message.images.map((image) => {
          totalImages += 1
          if (totalImages > MAX_IMAGES_TOTAL) throw new Error('AI images exceed the count limit')
          const parsedImage = parseImage(image)
          totalImageBytes += parsedImage.bytes
          if (totalImageBytes > MAX_IMAGE_BYTES_TOTAL) {
            throw new Error('AI images exceed the aggregate size limit')
          }
          return { base64: parsedImage.base64, mime: parsedImage.mime }
        })
        if (images.length > 0) parsed.images = images
      }
      messages.push(parsed)
    } else if (message.role === 'assistant') {
      assertOnlyKeys(message, ['role', 'text', 'toolCalls'], 'AI assistant message')
      const parsed: AiStreamRequest['messages'][number] = {
        role: 'assistant',
        text: boundedString(message.text, 'AI message text', MAX_USER_CHARS),
      }
      if (message.toolCalls !== undefined) {
        if (!Array.isArray(message.toolCalls) || message.toolCalls.length > MAX_TOOLS) {
          throw new Error('AI tool calls are invalid')
        }
        parsed.toolCalls = message.toolCalls.map((call) => {
          if (!isRecord(call)) throw new Error('AI tool call is invalid')
          assertOnlyKeys(call, ['id', 'name', 'input', 'inputError'], 'AI tool call')
          const result = {
            id: boundedString(call.id, 'AI tool call id', 512, false),
            name: boundedString(call.name, 'AI tool call name', 256, false),
            input: boundedJsonRecord(call.input, 'AI tool call input'),
          } as NonNullable<typeof parsed.toolCalls>[number]
          if (call.inputError !== undefined) {
            result.inputError = boundedString(call.inputError, 'AI tool call inputError', 4096)
          }
          return result
        })
      }
      messages.push(parsed)
    } else {
      assertOnlyKeys(message, ['role', 'results'], 'AI tool message')
      if (!Array.isArray(message.results) || message.results.length > MAX_TOOLS) {
        throw new Error('AI tool results are invalid')
      }
      messages.push({
        role: 'tool',
        results: message.results.map((result) => {
          if (!isRecord(result)) throw new Error('AI tool result is invalid')
          assertOnlyKeys(result, ['id', 'name', 'output', 'isError'], 'AI tool result')
          const parsedResult: { id: string; name: string; output: string; isError?: boolean } = {
            id: boundedString(result.id, 'AI tool result id', 512, false),
            name: boundedString(result.name, 'AI tool result name', 256, false),
            output: boundedString(result.output, 'AI tool result output', MAX_USER_CHARS),
          }
          if (result.isError !== undefined) {
            if (typeof result.isError !== 'boolean')
              throw new Error('AI tool result isError must be a boolean')
            parsedResult.isError = result.isError
          }
          return parsedResult
        }),
      })
    }
  }
  return messages
}

function parseTools(value: unknown): AiStreamRequest['tools'] {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_TOOLS) throw new Error('AI tools are invalid')
  for (const tool of value) {
    if (!isRecord(tool) || typeof tool.name !== 'string' || typeof tool.description !== 'string') {
      throw new Error('AI tool definition is invalid')
    }
    if (!isRecord(tool.inputSchema)) throw new Error('AI tool schema is invalid')
  }
  return value as AiStreamRequest['tools']
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
  return value
}

export function parseAiStreamRequest(value: unknown): AiStreamRequest {
  if (!isRecord(value)) throw new Error('AI stream request is required')
  assertOnlyKeys(
    value,
    ['requestId', 'conversation', 'system', 'messages', 'tools', 'maxTokens'],
    'AI stream request',
  )
  const request: AiStreamRequest = {
    requestId: boundedString(value.requestId, 'requestId', MAX_REQUEST_ID, false),
    system: boundedString(value.system, 'system', MAX_SYSTEM_CHARS),
    messages: parseMessages(value.messages),
  }
  const conversation = parseOptionalIdentity(value.conversation)
  const tools = parseTools(value.tools)
  if (conversation) request.conversation = conversation
  if (tools) request.tools = tools
  if (value.maxTokens !== undefined) {
    if (
      !Number.isInteger(value.maxTokens) ||
      Number(value.maxTokens) <= 0 ||
      Number(value.maxTokens) > 1_000_000
    ) {
      throw new Error('maxTokens is invalid')
    }
    request.maxTokens = Number(value.maxTokens)
  }
  return request
}

export function parseAiChatRequest(value: unknown): {
  conversation?: AiConversationIdentity
  system: string
  user: string
} {
  if (!isRecord(value)) throw new Error('AI chat request is required')
  assertOnlyKeys(value, ['conversation', 'system', 'user'], 'AI chat request')
  const request: { conversation?: AiConversationIdentity; system: string; user: string } = {
    system: boundedString(value.system, 'system', MAX_SYSTEM_CHARS),
    user: boundedString(value.user, 'user', MAX_USER_CHARS),
  }
  const conversation = parseOptionalIdentity(value.conversation)
  if (conversation) request.conversation = conversation
  return request
}

function getOrCreateRoute(
  options: RegisterAiRoutingIpcOptions,
  identity?: AiConversationIdentity,
): AiRoute {
  const globalDefault = options.settings.getGlobalDefault()
  return identity
    ? options
        .getProjectStore()
        .getOrCreateChatAiMetadata(identity.projectId, identity.chatId, globalDefault).route
    : globalDefault
}

async function resolveSendRoute(
  options: RegisterAiRoutingIpcOptions,
  identity?: AiConversationIdentity,
  requireImageInput = false,
): Promise<AiRoute> {
  const route = getOrCreateRoute(options, identity)
  await options.settings.assertRouteAvailable(route, { requireImageInput })
  return route
}

function isModelAvailabilityError(message: string): boolean {
  return /(?:model).*(?:not found|unavailable|expired|does not exist)|\b404\b/i.test(message)
}

async function refreshAfterModelError(
  settings: AiSettingsService,
  route: AiRoute,
  message: string,
) {
  if (!isModelAvailabilityError(message)) return
  await settings.refreshModels({
    providerIds: [route.providerId as 'genspark' | 'openrouter' | 'anthropic' | 'openai'],
  })
}

function safeError(error: unknown, config?: AiProviderConfig): string {
  return redactProviderError(error, config?.apiKey ? [config.apiKey] : [])
}

/** Register the credential-safe AI IPC contract. The caller owns idempotency. */
export function registerAiRoutingIpc(options: RegisterAiRoutingIpcOptions): void {
  const { ipcMain, settings } = options

  ipcMain.handle(AI_CHANNELS.getLegacySettings, () => settings.getLegacyPublicSettings())
  ipcMain.handle(AI_CHANNELS.getPublicSettings, () => settings.getPublicSettings())
  ipcMain.handle(AI_CHANNELS.setGlobalDefault, async (_event, value) => {
    try {
      return await settings.setGlobalDefault(parseRoute(value))
    } catch (error) {
      throw new Error(safeError(error), { cause: error })
    }
  })
  ipcMain.handle(AI_CHANNELS.verifyAndSaveProvider, async (_event, value) => {
    try {
      if (!isRecord(value)) throw new Error('Provider verification request is required')
      assertOnlyKeys(value, ['providerId', 'apiKey'], 'Provider verification request')
      return await settings.verifyAndSave({
        providerId: boundedString(value.providerId, 'providerId', 64, false) as
          'openrouter' | 'anthropic' | 'openai',
        apiKey: boundedString(value.apiKey, 'apiKey', 16_384, false),
      })
    } catch (error) {
      throw new Error(
        safeError(
          error,
          typeof value === 'object' && value !== null && 'apiKey' in value
            ? { apiKey: String(value.apiKey), model: '' }
            : undefined,
        ),
        { cause: error },
      )
    }
  })
  ipcMain.handle(AI_CHANNELS.removeProviderKey, (_event, providerId) => {
    try {
      return settings.removeProviderKey(providerId)
    } catch (error) {
      throw new Error(safeError(error), { cause: error })
    }
  })
  ipcMain.handle(AI_CHANNELS.listModels, async (_event, value) => {
    try {
      if (value !== undefined && !isRecord(value)) throw new Error('Model-list request is invalid')
      if (isRecord(value))
        assertOnlyKeys(value, ['requireImageInput', 'forceRefresh'], 'Model-list request')
      const requireImageInput = isRecord(value)
        ? optionalBoolean(value.requireImageInput, 'requireImageInput')
        : undefined
      const forceRefresh = isRecord(value)
        ? optionalBoolean(value.forceRefresh, 'forceRefresh')
        : undefined
      return await settings.listModels({
        ...(requireImageInput !== undefined ? { requireImageInput } : {}),
        ...(forceRefresh !== undefined ? { forceRefresh } : {}),
      })
    } catch (error) {
      throw new Error(safeError(error), { cause: error })
    }
  })
  ipcMain.handle(AI_CHANNELS.refreshModels, async (_event, value) => {
    try {
      if (value !== undefined && !isRecord(value))
        throw new Error('Model-refresh request is invalid')
      if (isRecord(value))
        assertOnlyKeys(value, ['providerIds', 'requireImageInput'], 'Model-refresh request')
      if (isRecord(value) && value.providerIds !== undefined && !Array.isArray(value.providerIds)) {
        throw new Error('providerIds must be an array')
      }
      const providerIds =
        isRecord(value) && Array.isArray(value.providerIds)
          ? value.providerIds.map((id) => {
              if (
                typeof id !== 'string' ||
                !['genspark', 'openrouter', 'anthropic', 'openai'].includes(id)
              ) {
                throw new Error('providerIds contains an unsupported provider')
              }
              return id as 'genspark' | 'openrouter' | 'anthropic' | 'openai'
            })
          : undefined
      const requireImageInput = isRecord(value)
        ? optionalBoolean(value.requireImageInput, 'requireImageInput')
        : undefined
      return await settings.refreshModels({
        ...(providerIds ? { providerIds } : {}),
        ...(requireImageInput !== undefined ? { requireImageInput } : {}),
      })
    } catch (error) {
      throw new Error(safeError(error), { cause: error })
    }
  })
  ipcMain.handle(AI_CHANNELS.getConversationRoute, async (_event, value) => {
    try {
      return getOrCreateRoute(options, parseIdentity(value))
    } catch (error) {
      throw new Error(safeError(error), { cause: error })
    }
  })
  ipcMain.handle(AI_CHANNELS.setConversationRoute, async (_event, identityValue, routeValue) => {
    try {
      const identity = parseIdentity(identityValue)
      const route = parseRoute(routeValue)
      await settings.assertRouteAvailable(route)
      return options.getProjectStore().setChatAiRoute(identity.projectId, identity.chatId, route)
        .route
    } catch (error) {
      throw new Error(safeError(error), { cause: error })
    }
  })

  ipcMain.handle(AI_CHANNELS.stream, async (event, value) => {
    let request: AiStreamRequest
    try {
      request = parseAiStreamRequest(value)
    } catch (error) {
      throw new Error(safeError(error), { cause: error })
    }
    if (activeStreams.has(request.requestId)) throw new Error('Duplicate AI request id')
    const send = (chunk: AiStreamChunk) => {
      if (!event.sender.isDestroyed()) event.sender.send(AI_CHANNELS.streamChunk, chunk)
    }
    let route: AiRoute | null = null
    let config: AiProviderConfig | undefined
    const controller = new AbortController()
    activeStreams.set(request.requestId, { controller, senderId: event.sender.id })
    try {
      const requireImageInput = request.messages.some(
        (message) => message.role === 'user' && Boolean(message.images?.length),
      )
      route = await resolveSendRoute(options, request.conversation, requireImageInput)
      config = settings.getProviderConfig(route, options.getGensparkApiKey)
      await streamForProvider(
        route.providerId,
        config,
        request.system,
        request.messages,
        request.tools ?? [],
        request.maxTokens ?? 8192,
        {
          signal: controller.signal,
          onDelta: (text) => send({ requestId: request.requestId, type: 'delta', text }),
          onToolCall: (toolCall) =>
            send({ requestId: request.requestId, type: 'tool-call', toolCall }),
        },
      )
      send({ requestId: request.requestId, type: 'done' })
    } catch (error) {
      if (controller.signal.aborted) {
        send({ requestId: request.requestId, type: 'done' })
      } else {
        const message = safeError(error, config)
        if (route) void refreshAfterModelError(settings, route, message).catch(() => undefined)
        send({ requestId: request.requestId, type: 'error', error: message })
      }
    } finally {
      activeStreams.delete(request.requestId)
    }
  })

  ipcMain.handle(AI_CHANNELS.streamCancel, (event, requestIdValue) => {
    const requestId = boundedString(requestIdValue, 'requestId', MAX_REQUEST_ID, false)
    const active = activeStreams.get(requestId)
    if (active?.senderId === event.sender.id) active.controller.abort()
  })

  ipcMain.handle(AI_CHANNELS.chat, async (_event, value): Promise<AiChatResponse> => {
    let config: AiProviderConfig | undefined
    let route: AiRoute | null = null
    try {
      const request = parseAiChatRequest(value)
      route = await resolveSendRoute(options, request.conversation)
      config = settings.getProviderConfig(route, options.getGensparkApiKey)
      const response = await chatForProvider(route.providerId, config, request.system, request.user)
      if (!response.ok && response.error) {
        const error = safeError(response.error, config)
        void refreshAfterModelError(settings, route, error).catch(() => undefined)
        return { ...response, error }
      }
      return response
    } catch (error) {
      const message = safeError(error, config)
      if (route) void refreshAfterModelError(settings, route, message).catch(() => undefined)
      return { ok: false, error: message }
    }
  })
}
