import type { Lang } from '@genoffice/i18n'
import type { AiModelSummary, AiProviderId, AiRoute, AiStreamChunk } from '@genoffice/ai-provider'
import type { AgentMessage, AgentToolDef } from '@genoffice/agent-core'

export const PDF_CHANNELS = {
  consumePending: 'pdf:consume-pending',
  readFile: 'pdf:read-file',
  save: 'pdf:save',
  extractPages: 'pdf:extract-pages',
  insertPdf: 'pdf:insert-pdf',
  exportImages: 'pdf:export-images',
  dirtyChanged: 'pdf:dirty-changed',
  closeSaveRequest: 'pdf:close-save-request',
  closeSaveResult: 'pdf:close-save-result',
  getLanguage: 'app:get-language',
  languageChanged: 'app:language-changed',
} as const

export type MarkupType = 'highlight' | 'underline' | 'strikeout'

/** A text markup to write; quads are 4-point groups in PDF coords (y up) [x1,yTop,x2,yTop,x1,yBottom,x2,yBottom] */
export interface MarkupInput {
  pageIndex: number
  type: MarkupType
  /** rgb normalized to 0-1 */
  color: [number, number, number]
  quads: number[][]
}

/** Drawing annotations (all coords in PDF user space, y up).
    One union member per kind; a union-literal kind would break TS narrowing. */
interface DrawBase {
  pageIndex: number
  color: [number, number, number]
  width: number
}

export type DrawingInput =
  | (DrawBase & {
      kind: 'ink'
      /** Each stroke as [x1,y1,x2,y2,...] */
      paths: number[][]
    })
  | (DrawBase & { kind: 'rect'; rect: [number, number, number, number] })
  | (DrawBase & { kind: 'ellipse'; rect: [number, number, number, number] })
  | (DrawBase & { kind: 'line'; from: [number, number]; to: [number, number] })
  | (DrawBase & { kind: 'arrow'; from: [number, number]; to: [number, number] })
  | {
      kind: 'note'
      pageIndex: number
      color: [number, number, number]
      at: [number, number]
      contents: string
    }

/**
 * Stamp layer (watermark/header/footer/page numbers all go through it).
 * The renderer rasterizes the bitmap via canvas (with rotation and fonts, bypassing
 * pdf-lib's lack of CJK support); the main process only embeds and positions it.
 */
export interface StampInput {
  pageIndex: number
  /** base64 PNG, without the data: prefix */
  image: string
  /** PDF user space [x1,y1,x2,y2] */
  rect: [number, number, number, number]
  opacity?: number
}

/** Document info; an empty string clears the field */
export interface MetadataInput {
  title?: string
  author?: string
  subject?: string
  keywords?: string
}

export interface FormValueInput {
  name: string
  kind: 'text' | 'checkbox' | 'radio' | 'choice'
  /** For radio: selected exportValue; for choice: selected option; empty string clears selection */
  value?: string
  checked?: boolean
}

export interface SavePdfRequest {
  path: string
  markups: MarkupInput[]
  drawings: DrawingInput[]
  formValues: FormValueInput[]
  stamps: StampInput[]
  /** Page rotation deltas (original page index → multiple of 90 clockwise) */
  rotations?: { pageIndex: number; delta: number }[]
  /** Pages to delete (original page indices) */
  deletedPages?: number[]
  /** New page order (array of original page indices, excluding deleted); omitted if unreordered */
  pageOrder?: number[]
  metadata?: MetadataInput
}

export type SavePdfResult = { ok: true } | { ok: false; error: string }

/** Extract pages into a new PDF: main process shows a save dialog; cancel returns canceled */
export interface ExtractPagesRequest {
  path: string
  /** Original page indices */
  pages: number[]
  suggestedName: string
}

export type ExtractPagesResult =
  { ok: true; savedPath: string } | { ok: true; canceled: true } | { ok: false; error: string }

/** Insert (merge) another PDF after a page of the current file: main process shows a picker and writes back immediately */
export interface InsertPdfRequest {
  path: string
  /** Insert after this original page index; -1 means front of the document */
  afterPageIndex: number
}

export type InsertPdfResult =
  { ok: true; insertedCount: number } | { ok: true; canceled: true } | { ok: false; error: string }

/** Export pages as PNG: renderer rasterizes the bitmaps, main process shows a dialog and writes to disk */
export interface ExportImagesRequest {
  /** base64 PNGs (without the data: prefix), in page order */
  images: string[]
  /** 1-based page numbers, same length as images, used for file names */
  pageNumbers: number[]
  baseName: string
}

export type ExportImagesResult =
  | { ok: true; savedDir: string; count: number }
  | { ok: true; canceled: true }
  | { ok: false; error: string }

/** AI channels are app-wide shared ipcMain handlers (shell registers via docs-main registerAiIpc); pass-through only */
export const AI_CHANNELS = {
  getPublicSettings: 'ai:settings:get-public',
  listModels: 'ai:models:list',
  getConversationRoute: 'ai:conversation:get-route',
  setConversationRoute: 'ai:conversation:set-route',
  stream: 'ai:stream',
  streamChunk: 'ai:stream-chunk',
  streamCancel: 'ai:stream-cancel',
} as const

export const PROJECT_CHANNELS = {
  resolveChat: 'project:resolveChat',
  appendChat: 'project:appendChat',
  loadChat: 'project:loadChat',
  rebindChat: 'project:rebindChat',
} as const

export type PublicAiProviderId = Extract<
  AiProviderId,
  'genspark' | 'openrouter' | 'anthropic' | 'openai'
>

export interface AiConversationIdentity {
  projectId: string
  chatId: string
}

export interface PublicAiProvider {
  id: PublicAiProviderId
  label: string
  status: 'connected' | 'not-configured' | 'unverified' | 'unavailable'
  hasApiKey: boolean
  verifiedAt?: string
  accountLabel?: string
}

export interface PublicAiSettings {
  schemaVersion: 1
  globalDefault: AiRoute
  providers: PublicAiProvider[]
  secureStorageAvailable: boolean
}

export interface ListAiModelsArgs {
  requireImageInput?: boolean
  forceRefresh?: boolean
}

export interface AiModelCatalogState {
  providerId: PublicAiProviderId
  fetchedAt: string | null
  stale: boolean
  error?: string
}

export interface ListAiModelsResult {
  models: AiModelSummary[]
  catalogs: AiModelCatalogState[]
}

/** Renderer-safe AI request. Provider credentials and raw provider settings never cross IPC. */
export interface PdfAiStreamRequest {
  requestId: string
  conversation?: AiConversationIdentity
  system: string
  messages: AgentMessage[]
  tools?: AgentToolDef[]
  maxTokens?: number
}

/** Copy only the renderer-safe allowlist before handing a request to Electron IPC. */
export function toRouteOnlyAiStreamRequest(request: PdfAiStreamRequest): PdfAiStreamRequest {
  return {
    requestId: request.requestId,
    ...(request.conversation ? { conversation: request.conversation } : {}),
    system: request.system,
    messages: request.messages,
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
  }
}

export interface ProjectToolActivity {
  name: string
  summary: string
  isError?: boolean
  input?: string
  output?: string
}

export interface ProjectChatMessage {
  seq: number
  ts: string
  role: 'user' | 'assistant'
  text: string
  tools?: ProjectToolActivity[]
  ai?: { requested: AiRoute; resolved?: AiRoute }
}

export interface AppendProjectChatArgs {
  projectId: string
  chatId: string
  role: 'user' | 'assistant'
  text: string
  tools?: ProjectToolActivity[]
  ai?: { requested: AiRoute; resolved?: AiRoute }
}

export interface RebindProjectChatArgs {
  projectId: string
  tempChatId: string
  newChatId?: string
  newFilePath?: string
  sessionId?: string
}

/** API exposed by preload to the renderer (window.pdfApi) */
export interface PdfApi {
  /** Take the pdf path pending for this view (queued at tab creation); null if none */
  consumePending(): Promise<string | null>
  /** Read pdf bytes. Only paths granted to this view are allowed */
  readFile(path: string): Promise<ArrayBuffer>
  /** Write markups/form values/page ops back to the original file (pdf-lib, content streams untouched); path grants same as readFile */
  save(request: SavePdfRequest): Promise<SavePdfResult>
  extractPages(request: ExtractPagesRequest): Promise<ExtractPagesResult>
  insertPdf(request: InsertPdfRequest): Promise<InsertPdfResult>
  exportImages(request: ExportImagesRequest): Promise<ExportImagesResult>
  /** Mirror unsaved-changes state to the main process; drives the save prompt before closing a tab/window */
  setDirty(dirty: boolean): void
  /** Main process picked "Save" in the close prompt → renderer saves and replies via sendCloseSaveResult */
  onCloseSaveRequest(handler: () => void): () => void
  sendCloseSaveResult(ok: boolean): void
  getLanguage(): Promise<Lang>
  onLanguageChanged(handler: (lang: Lang) => void): () => void
  getAiPublicSettings(): Promise<PublicAiSettings>
  listAiModels(args?: ListAiModelsArgs): Promise<ListAiModelsResult>
  getAiConversationRoute(identity: AiConversationIdentity): Promise<AiRoute>
  setAiConversationRoute(identity: AiConversationIdentity, route: AiRoute): Promise<AiRoute>
  aiStream(request: PdfAiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void
  resolveProjectChat(args: {
    filePath: string | null
    tempChatId?: string
    sessionId?: string
  }): Promise<AiConversationIdentity>
  appendProjectChat(args: AppendProjectChatArgs): Promise<void>
  loadProjectChat(args: {
    projectId: string
    chatId: string
    limit?: number
  }): Promise<ProjectChatMessage[]>
  rebindProjectChat(args: RebindProjectChatArgs): Promise<AiConversationIdentity>
}
