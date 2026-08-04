import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Block } from '@genoffice/docx-engine'
import { openRouterRetryRoute, openRouterRetrySuggestion } from '@genoffice/ai-provider'
import {
  AgentLoop,
  composeSkills,
  type AgentImage,
  type AgentTransport,
  type CompactionOptions,
} from '@genoffice/agent-core'
import type {
  AiConversationIdentity,
  AiModelSummary,
  AiRoute,
  AttachmentAddResult,
  AttachmentMeta,
  PublicAiProvider,
} from '../../shared/ipc'
import { ATTACHMENT_IMAGE_EXTS } from '../../shared/ipc'
import type { PmNode } from '../editor/convert'
import { findNumId, type NumIds } from './protocol'
import { createDocsSkill } from './docs-skill'
import { applyRevisionsBy } from '../editor/revisions'
import { DOCS_AGENT_MAX_TURNS, DOCS_CONTINUE_INSTRUCTION } from './continuation'
import { createFilesSkill } from './files-skill'
import { createElectronTransport } from './transport'
import { useI18n, t as tModule, aiLangDirective, type StringKey } from '../i18n/locale'
import {
  AiComposer,
  AiTypingIndicator,
  Markdown,
  ModelPicker,
  type ModelPickerModel,
} from '@genoffice/ui'
import { AiMark } from '../components/icons'
import sendEnterOn from '../assets/send-enter-on.png'
import sendEnterOff from '../assets/send-enter-off.png'
import sendStop from '../assets/send-stop.png'
import attachIcon from '../assets/attach-icon.png'
import {
  IconClock,
  IconNewChat,
  IconPaperclip,
  IconRefresh,
  IconSidebarCollapse,
} from '../components/icons'

interface Snapshot {
  label: string
  time: string
  json: PmNode
}

interface ToolActivity {
  name: string
  summary: string
  /** still executing: rendered as a spinner chip, replaced in place when the tool finishes */
  running?: boolean
  isError?: boolean
  /** Tool output (truncated on the UI side); when set, the row can be expanded for details */
  output?: string
}

/** Max characters of tool output in the UI expansion panel */
const TOOL_OUTPUT_MAX_CHARS = 2000

/** Cap on tool args/output persisted in the transcript (the store layer has another 16k truncation fallback) */
const PERSIST_TOOL_FIELD_MAX = 16_000

/** Tool args → JSON string (truncated; returns undefined on serialization failure, doesn't block persistence) */
function safeJsonInput(input: unknown): string | undefined {
  try {
    const s = JSON.stringify(input)
    return s && s !== '{}' ? s.slice(0, PERSIST_TOOL_FIELD_MAX) : undefined
  } catch {
    return undefined
  }
}

interface ChatEntry {
  role: 'user' | 'assistant'
  text: string
  /** UI-only provenance marker; it never enters model history as a message. */
  modelSwitch?: string
  error?: string
  /** A failed model turn may be retried through OpenRouter's router. */
  retrySuggestion?: string
  retryRoute?: AiRoute
  streaming?: boolean
  turnLimit?: boolean
  /** the run failed and this user message was rolled back out of the model context */
  undelivered?: boolean
  /** the run failed because Genspark is signed out — render an inline sign-in button */
  loginRequired?: boolean
  /** tool executions performed during this assistant turn */
  tools?: ToolActivity[]
}

/** clickable starter prompts for the empty state (fill the input, do not send) —
 * blank documents get generation starters, documents with content get edit starters */
const DRAFT_STARTER_PROMPTS: StringKey[] = [
  'aiStarterWeeklyReport',
  'aiStarterLaunchPost',
  'aiStarterEventOutline',
]
const EDIT_STARTER_PROMPTS: StringKey[] = [
  'aiStarterSummarize',
  'aiStarterPolishAll',
  'aiStarterContinue',
]

/** resizable panel width: persisted, clamped so neither pane collapses */
const PANEL_WIDTH_KEY = 'docs-ai-panel-width'
const PANEL_WIDTH_DEFAULT = 540
const PANEL_WIDTH_MIN = 280

function maxPanelWidth(): number {
  return Math.min(720, Math.round(window.innerWidth * 0.6))
}

function clampPanelWidth(w: number): number {
  return Math.min(Math.max(w, PANEL_WIDTH_MIN), maxPanelWidth())
}

function loadPanelWidth(): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  return Number.isFinite(saved) && saved > 0 ? clampPanelWidth(saved) : PANEL_WIDTH_DEFAULT
}

/** persisted UI preference: highlight AI edits in yellow and ask for confirmation */
const TRACK_CHANGES_KEY = 'ai-docs-track-changes'

const IMAGE_UNSUPPORTED_NOTICE =
  'This model does not accept images. Choose an image-capable model to paste, drop, or attach one.'

/** Keep headroom for prompts, tool schemas, and provider tokenization differences. */
export function modelCompactionBudget(model: AiModelSummary): CompactionOptions | false {
  const tokens = model.capabilities.contextWindow
  if (!tokens || tokens <= 0) return { maxBytes: 256_000, keepRecentBytes: 96_000 }
  const maxBytes = Math.max(32_000, Math.floor(tokens * 3 * 0.8))
  return {
    maxBytes,
    keepRecentBytes: Math.max(12_000, Math.floor(maxBytes * 0.375)),
  }
}

export function modelSupportsImages(model: AiModelSummary | undefined): boolean {
  return model?.capabilities.inputModalities.includes('image') === true
}

export function isDocsCompatibleModel(model: AiModelSummary, requireImages: boolean): boolean {
  return (
    model.available &&
    model.capabilities.inputModalities.includes('text') &&
    model.capabilities.outputModalities.includes('text') &&
    model.capabilities.supportsTools &&
    (!requireImages || modelSupportsImages(model))
  )
}

export function toPickerModel(
  model: AiModelSummary,
  providers: readonly PublicAiProvider[],
): ModelPickerModel {
  const providerLabel = providers.find((provider) => provider.id === model.providerId)?.label
  const capabilityLabels = [
    modelSupportsImages(model) ? 'Images' : 'Text only',
    model.capabilities.contextWindow
      ? `${Math.round(model.capabilities.contextWindow / 1000)}K context`
      : undefined,
  ].filter((label): label is string => Boolean(label))
  return {
    providerId: model.providerId,
    modelId: model.id,
    providerLabel: providerLabel ?? model.providerId,
    label: model.name,
    shortLabel: model.name,
    description: model.description,
    capabilityLabels,
    searchTerms: [model.id, model.canonicalId],
  }
}

/** Clipboard bitmap MIME → attachment extension (corresponds to ATTACHMENT_IMAGE_EXTS) */
const PASTE_MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** author name on AI-generated tracked revisions (accept/reject via Review) */
export const AI_REVISION_AUTHOR = 'AI Assistant'

interface AiPanelProps {
  editor: Editor
  blocks: Block[]
  /** the document has no text yet — the empty-state copy offers drafting instead of editing */
  docEmpty?: boolean
  /** fallback numbering ids for documents created from the blank template */
  numIdFallback?: NumIds | null
  /** preset instruction pushed from the ribbon or start screen; autoRun sends it immediately */
  preset?: { text: string; nonce: number; autoRun?: boolean } | null
  /** false shows only the collapsed rail; the component stays mounted so panel state survives */
  open?: boolean
  /** expand from the collapsed rail */
  onExpand?: () => void
  /** collapse the panel to the sidebar rail */
  onCollapse?: () => void
  /** Absolute path of the currently open file (used for chat-history persistence) */
  filePath?: string | null
}

export function AiPanel({
  editor,
  blocks,
  docEmpty,
  numIdFallback,
  preset,
  open = true,
  onExpand,
  onCollapse,
  filePath,
}: AiPanelProps) {
  const { t } = useI18n()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  /** Wall-clock start of the current run, drives the elapsed badge */
  const runStartedAtRef = useRef(0)
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [trackChanges, setTrackChanges] = useState(
    () => localStorage.getItem(TRACK_CHANGES_KEY) === '1',
  )
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([])
  const [attachNotice, setAttachNotice] = useState<string | null>(null)
  const [models, setModels] = useState<AiModelSummary[]>([])
  const modelsRef = useRef<AiModelSummary[]>([])
  modelsRef.current = models
  const [providers, setProviders] = useState<PublicAiProvider[]>([])
  const [selectedRoute, setSelectedRoute] = useState<AiRoute | null>(null)
  const [routeReady, setRouteReady] = useState(false)
  const [routeSwitching, setRouteSwitching] = useState(false)
  const [modelNotice, setModelNotice] = useState<string | null>(null)
  const [conversationHasImages, setConversationHasImages] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [panelWidth, setPanelWidth] = useState(loadPanelWidth)
  const [resizing, setResizing] = useState(false)
  const asideRef = useRef<HTMLElement>(null)

  // The .ai-dock wrapper owns the animated width (Excel-parity 180ms slide);
  // it tracks the resizable panel width through this variable
  // `open` dep: the aside ref only exists while expanded
  useEffect(() => {
    const dock = asideRef.current?.closest('.ai-dock') as HTMLElement | null
    dock?.style.setProperty('--ai-panel-width', `${panelWidth}px`)
  }, [panelWidth, open])

  // Re-clamp the persisted width when the window shrinks (max is 60% of the window)
  useEffect(() => {
    const onResize = () => setPanelWidth((w) => clampPanelWidth(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  /** Past conversation restored from JSONL (read-only transcript, not fed to the model) */
  const [historicChat, setHistoricChat] = useState<ChatEntry[]>([])
  // bumped on selection/doc changes so the scope hint & quick actions stay fresh
  const [, setScopeTick] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** false once the user scrolls up to read; re-arms near the bottom */
  const stickToBottomRef = useRef(true)
  /** projectId/chatId of the current chat */
  const chatRefIds = useRef<AiConversationIdentity | null>(null)
  const routeRef = useRef<AiRoute | null>(null)
  const routeWriteRef = useRef<Promise<void>>(Promise.resolve())
  const runDispatchPendingRef = useRef(false)
  const activeRunRouteRef = useRef<AiRoute | null>(null)
  const modelRefreshRequestRef = useRef(0)

  // latest props for the loop's closures (the loop instance outlives renders)
  const editorRef = useRef(editor)
  editorRef.current = editor
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const numIdFallbackRef = useRef(numIdFallback)
  numIdFallbackRef.current = numIdFallback
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const trackChangesRef = useRef(trackChanges)
  trackChangesRef.current = trackChanges

  /** drop every aiChanged flag; silent = skip undo history (auto-accept path) */
  const clearAiHighlights = (silent = false) => {
    const view = editorRef.current.view
    let tr = view.state.tr
    let touched = false
    view.state.doc.forEach((node, offset) => {
      if (node.attrs.aiChanged) {
        tr = tr.setNodeMarkup(offset, undefined, { ...node.attrs, aiChanged: false })
        touched = true
      }
    })
    if (silent) tr = tr.setMeta('addToHistory', false)
    if (touched) view.dispatch(tr)
  }
  /** instruction of the in-flight run, labels its rollback snapshot */
  const instructionRef = useRef('')
  /** last sent instruction, for one-click retry */
  const lastInstructionRef = useRef('')
  /** Tool activity of the whole run (with args/output, accumulated across turns) — for full
      transcript persistence, and so persisting needn't do side effects inside a setState updater */
  const runToolsRef = useRef<
    Array<{ name: string; summary: string; isError?: boolean; input?: string; output?: string }>
  >([])

  // ── Chat-history persistence ────────────────────────────────────────────
  useEffect(() => {
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!api) return
    let cancelled = false
    const tempChatId = `unsaved-${Date.now()}`
    void (async () => {
      try {
        const [ids, publicSettings, catalog] = await Promise.all([
          api.resolveChat({ filePath: filePath ?? null, tempChatId }),
          window.desktop.getAiPublicSettings(),
          window.desktop.listAiModels(),
        ])
        if (cancelled) return
        chatRefIds.current = ids
        setProviders(publicSettings.providers)
        setModels(catalog.models.filter((model) => isDocsCompatibleModel(model, false)))

        // Route reads always cross the main-process validation boundary. Main
        // creates the sticky sidecar from the current global default if absent.
        const metadata = { route: await window.desktop.getAiConversationRoute(ids) }
        if (cancelled) return
        routeRef.current = metadata.route
        setSelectedRoute(metadata.route)
        setRouteReady(true)

        const msgs = await api.loadChat({
          projectId: ids.projectId,
          chatId: ids.chatId,
          limit: 200,
        })
        if (cancelled || msgs.length === 0) return
        setHistoricChat(
          msgs.map((m) => ({
            role: m.role,
            text: m.text,
            tools: m.tools?.map((t) => ({
              name: t.name,
              summary: t.summary,
              isError: t.isError,
              output: t.output ? t.output.slice(0, TOOL_OUTPUT_MAX_CHARS) : undefined,
            })),
          })),
        )
        if (
          msgs.some((message) =>
            message.attachments?.some((attachment) =>
              ATTACHMENT_IMAGE_EXTS.has(attachment.ext?.toLowerCase() ?? ''),
            ),
          )
        ) {
          setConversationHasImages(true)
        }
        // restore model context: follow-ups after reopening a file continue the previous conversation (only when the loop is idle with no history)
        loopRef.current?.restore(msgs.map((m) => ({ role: m.role, text: m.text })))
      } catch {
        if (!cancelled) {
          setRouteReady(true)
          setModelNotice('Model selection is temporarily unavailable for this document.')
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const requiresImageModel =
    conversationHasImages ||
    attachments.some((attachment) => ATTACHMENT_IMAGE_EXTS.has(attachment.ext))

  const refreshModelsForPicker = (): void => {
    const requestId = ++modelRefreshRequestRef.current
    void Promise.all([window.desktop.getAiPublicSettings(), window.desktop.listAiModels()])
      .then(([publicSettings, catalog]) => {
        if (requestId !== modelRefreshRequestRef.current) return
        setProviders(publicSettings.providers)
        setModels(catalog.models.filter((model) => isDocsCompatibleModel(model, false)))
      })
      .catch(() => undefined)
  }

  useEffect(() => {
    if (!routeReady) return
    let cancelled = false
    void window.desktop
      .listAiModels({ requireImageInput: requiresImageModel })
      .then((catalog) => {
        if (!cancelled) {
          setModels(
            catalog.models.filter((model) => isDocsCompatibleModel(model, requiresImageModel)),
          )
        }
      })
      .catch(() => {
        if (!cancelled) setModelNotice('Could not refresh image-capable models.')
      })
    return () => {
      cancelled = true
    }
  }, [requiresImageModel, routeReady])

  /** After an unsaved document's first save yields a real path, bind the unsaved-* history to that file (recoverable by path on reopen) */
  useEffect(() => {
    const ids = chatRefIds.current
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!api || !ids || !filePath || !ids.chatId.startsWith('unsaved-')) return
    void api
      .rebindChat({ projectId: ids.projectId, tempChatId: ids.chatId, newFilePath: filePath })
      .then((r) => {
        if (r?.chatId) chatRefIds.current = r
      })
      .catch(() => {
        /* silent */
      })
  }, [filePath])

  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: Array<{
      name: string
      summary: string
      isError?: boolean
      input?: string
      output?: string
    }>,
    attachments?: AttachmentMeta[],
    route?: AiRoute | null,
  ) => {
    const ids = chatRefIds.current
    const api = (window as Window & { projectApi?: typeof window.projectApi }).projectApi
    if (!ids || !api) return
    void api
      .appendChat({
        projectId: ids.projectId,
        chatId: ids.chatId,
        role,
        text,
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(attachments && attachments.length > 0
          ? {
              attachments: attachments.map((a) => ({
                name: a.name,
                path: a.path,
                ext: a.ext,
                sizeBytes: a.sizeBytes,
              })),
            }
          : {}),
        ...(role === 'assistant' && route ? { ai: { requested: route } } : {}),
      })
      .catch(() => {
        /* silent */
      })
  }

  const patchLastAssistant = (
    patch: Partial<ChatEntry> | ((last: ChatEntry) => Partial<ChatEntry>),
  ) => {
    setChat((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') return prev
      next[next.length - 1] = { ...last, ...(typeof patch === 'function' ? patch(last) : patch) }
      return next
    })
  }

  const transportRef = useRef<AgentTransport | null>(null)
  if (!transportRef.current) {
    transportRef.current = createElectronTransport(() => chatRefIds.current ?? undefined)
  }
  const loopRef = useRef<AgentLoop<PmNode> | null>(null)
  if (!loopRef.current) {
    const numIds = (): NumIds => ({
      bullet: findNumId(blocksRef.current, 'bullet') ?? numIdFallbackRef.current?.bullet ?? null,
      ordered: findNumId(blocksRef.current, 'ordered') ?? numIdFallbackRef.current?.ordered ?? null,
    })
    loopRef.current = new AgentLoop<PmNode>({
      transport: transportRef.current,
      systemSuffix: aiLangDirective,
      maxTurns: DOCS_AGENT_MAX_TURNS,
      skill: composeSkills('docs+files', '', [
        createDocsSkill(
          () => editorRef.current,
          numIds,
          () => (trackChangesRef.current ? { author: AI_REVISION_AUTHOR } : undefined),
        ),
        createFilesSkill(() => attachmentsRef.current),
      ]),
      captureSnapshot: () => editorRef.current.getJSON() as PmNode,
      events: {
        onText: (text) => patchLastAssistant({ text }),
        onToolStart: (call) => {
          // Live "running" chip: replaced in place by onToolExecuted
          patchLastAssistant((last) => ({
            tools: [
              ...(last.tools ?? []),
              { name: call.name, summary: call.name.replace(/[_-]+/g, ' '), running: true },
            ],
          }))
        },
        onToolExecuted: ({ call, execution, snapshotBefore }) => {
          if (snapshotBefore) {
            setSnapshots((prev) =>
              [
                {
                  label: instructionRef.current.slice(0, 40),
                  time: new Date().toLocaleTimeString(),
                  json: snapshotBefore,
                },
                ...prev,
              ].slice(0, 20),
            )
          }
          if (execution.mutated) {
            // tracking off: accept immediately (same tick, so the yellow never paints);
            // tracking on: revisions stay pending, handled in the Review tab
            if (!trackChangesRef.current) clearAiHighlights(true)
          }
          runToolsRef.current.push({
            name: call.name,
            summary: execution.summary,
            isError: execution.isError,
            input: safeJsonInput(call.input),
            output: execution.output
              ? execution.output.slice(0, PERSIST_TOOL_FIELD_MAX)
              : undefined,
          })
          patchLastAssistant((last) => {
            // Swap out the running placeholder pushed by onToolStart (parse-fail calls have none)
            const tools = [...(last.tools ?? [])]
            if (tools.at(-1)?.running) tools.pop()
            return {
              tools: [
                ...tools,
                {
                  name: call.name,
                  summary: execution.summary,
                  isError: execution.isError,
                  output: execution.output
                    ? execution.output.slice(0, TOOL_OUTPUT_MAX_CHARS)
                    : undefined,
                },
              ],
            }
          })
        },
        onTurnEnd: () => {
          patchLastAssistant({ streaming: false })
          setChat((prev) => [...prev, { role: 'assistant', text: '', streaming: true }])
        },
        onDone: ({ text, cancelled, turnLimit }) => {
          // module-level t: the loop instance is created only once; the component's t goes stale with the first-render closure
          const finalText = turnLimit
            ? [text, tModule('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tModule('aiStopped') : '')
          patchLastAssistant((last) => ({
            streaming: false,
            turnLimit,
            text: finalText || (last.tools?.length ? last.text : tModule('aiNoReply')),
            // A stop mid-tool can leave a running placeholder behind — drop it
            tools: last.tools?.filter((tl) => !tl.running),
          }))
          setBusy(false)
          runDispatchPendingRef.current = false
          // App listens: a run that generated content into a never-saved document
          // triggers a silent first save with a content-derived file name
          window.dispatchEvent(new Event('ai-docs-run-done'))
          // persist outside the updater (a double-invoked updater would write history twice); tools stores the whole run's full activity
          if (finalText && !cancelled) {
            persistMessage(
              'assistant',
              finalText,
              runToolsRef.current,
              undefined,
              activeRunRouteRef.current,
            )
          }
        },
        onError: (error) => {
          const failedRoute = activeRunRouteRef.current
          const failedModel = failedRoute
            ? modelsRef.current.find(
                (model) =>
                  model.providerId === failedRoute.providerId && model.id === failedRoute.modelId,
              )
            : undefined
          setChat((prev) => {
            const next = [...prev]
            // the loop rolled this run's user message out of the model context — surface that
            for (let i = next.length - 1; i >= 0; i--) {
              const entry = next[i]!
              if (entry.role === 'user') {
                next[i] = { ...entry, undelivered: true }
                break
              }
            }
            const last = next.at(-1)
            if (last?.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                streaming: false,
                error,
                retrySuggestion: failedRoute
                  ? openRouterRetrySuggestion(failedRoute, failedModel)
                  : undefined,
                retryRoute: failedRoute
                  ? openRouterRetryRoute(failedRoute, failedModel)
                  : undefined,
                tools: last.tools?.filter((tl) => !tl.running),
              }
            }
            return next
          })
          // A Genspark sign-in action belongs only to a failed Genspark route.
          if (failedRoute?.providerId === 'genspark') {
            void window.desktop
              .aiGskStatus()
              .then((status) => {
                if (status.loggedIn) return
                setChat((prev) => {
                  const next = [...prev]
                  const last = next.at(-1)
                  if (last?.role === 'assistant' && last.error) {
                    next[next.length - 1] = { ...last, loginRequired: true }
                  }
                  return next
                })
              })
              .catch(() => {})
          }
          setBusy(false)
          runDispatchPendingRef.current = false
        },
      },
    })
  }

  const selectedModel = selectedRoute
    ? models.find(
        (model) =>
          model.providerId === selectedRoute.providerId && model.id === selectedRoute.modelId,
      )
    : undefined
  const selectedModelSupportsImages = modelSupportsImages(selectedModel)
  const compatiblePickerModels = models
    .filter((model) => isDocsCompatibleModel(model, requiresImageModel))
    .map((model) => toPickerModel(model, providers))
  const selectedRouteUnavailable = routeReady && selectedRoute != null && selectedModel == null
  const unavailableSelectedModel: ModelPickerModel | null = selectedRouteUnavailable
    ? {
        providerId: selectedRoute.providerId,
        modelId: selectedRoute.modelId,
        providerLabel:
          providers.find((provider) => provider.id === selectedRoute.providerId)?.label ??
          selectedRoute.providerId,
        label: `${selectedRoute.modelId} (Unavailable)`,
        shortLabel: `${selectedRoute.modelId} (Unavailable)`,
        description: 'This saved route is no longer available or compatible.',
        capabilityLabels: ['Choose another model before sending'],
      }
    : null
  const pickerModels = unavailableSelectedModel
    ? [unavailableSelectedModel, ...compatiblePickerModels]
    : compatiblePickerModels

  const switchModel = async (picked: ModelPickerModel): Promise<boolean> => {
    const ids = chatRefIds.current
    const incoming = models.find(
      (model) => model.providerId === picked.providerId && model.id === picked.modelId,
    )
    if (!ids || !incoming || busy || routeSwitching) return false

    const route: AiRoute = { providerId: incoming.providerId, modelId: incoming.id }
    if (
      routeRef.current?.providerId === route.providerId &&
      routeRef.current.modelId === route.modelId
    ) {
      return true
    }
    setRouteSwitching(true)
    setModelNotice(null)
    let switched = false
    routeWriteRef.current = (async () => {
      let preparation: Awaited<ReturnType<AgentLoop['prepareModelSwitch']>> | undefined
      try {
        preparation = await loopRef.current?.prepareModelSwitch({
          outgoingTransport: transportRef.current!,
          incomingCompaction: modelCompactionBudget(incoming),
        })
        if (preparation && !preparation.applied) {
          throw new Error('The conversation became busy before the model switch completed.')
        }

        // Main validates provider configuration, catalog availability, and
        // compatibility before persisting the document route.
        const metadata = { route: await window.desktop.setAiConversationRoute(ids, route) }
        preparation?.commit()
        routeRef.current = metadata.route
        setSelectedRoute(metadata.route)
        setChat((previous) => [
          ...previous,
          { role: 'assistant', text: '', modelSwitch: incoming.name },
        ])
        switched = true
      } catch (error) {
        preparation?.rollback()
        throw error
      }
    })()
      .catch((error: unknown) => {
        setModelNotice(error instanceof Error ? error.message : 'Could not change models.')
      })
      .finally(() => setRouteSwitching(false))
    await routeWriteRef.current
    return switched
  }

  const selectModel = (picked: ModelPickerModel) => {
    void switchModel(picked)
  }

  useEffect(() => {
    if (!preset) return
    if (!routeReady) return
    if (preset.autoRun) runWith(preset.text)
    else {
      setInput(preset.text)
      inputRef.current?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.nonce, routeReady])

  // keep the scope hint & quick actions in sync with the editor selection
  useEffect(() => {
    const bump = () => setScopeTick((t) => t + 1)
    editor.on('selectionUpdate', bump)
    editor.on('update', bump)
    return () => {
      editor.off('selectionUpdate', bump)
      editor.off('update', bump)
    }
  }, [editor])

  // follow the stream, but stop yanking once the user scrolls up to read;
  // `open` dep: re-expanding lands on messages streamed while collapsed
  useEffect(() => {
    if (stickToBottomRef.current) {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
    }
  }, [chat, open])

  const onLogScroll = () => {
    const el = logRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const run = () => runWith(input.trim())

  /** Image attachments are read as base64 and go multimodal with this user message (≤5MB per image, max 20) */
  const MAX_IMAGES_PER_MESSAGE = 20
  const collectImageAttachments = async (): Promise<AgentImage[]> => {
    const imageAtts = attachmentsRef.current.filter((a) => ATTACHMENT_IMAGE_EXTS.has(a.ext))
    const images: AgentImage[] = []
    const failures: string[] = []
    for (const att of imageAtts.slice(0, MAX_IMAGES_PER_MESSAGE)) {
      const result = await window.desktop.readAttachmentImage(att.path)
      if (result.ok && result.base64 && result.mime) {
        images.push({ base64: result.base64, mime: result.mime })
      } else {
        failures.push(result.error ?? t('aiImageReadFail', { name: att.name }))
      }
    }
    if (imageAtts.length > MAX_IMAGES_PER_MESSAGE) {
      failures.push(t('aiTooManyImages', { max: MAX_IMAGES_PER_MESSAGE }))
    }
    if (failures.length > 0) {
      setAttachNotice(failures.join(';'))
      window.setTimeout(() => setAttachNotice(null), 5000)
    }
    return images
  }

  const runWith = (instruction: string, displayInstruction = instruction) => {
    const loop = loopRef.current
    const route = routeRef.current
    if (
      !instruction ||
      !loop ||
      !route ||
      loop.busy ||
      runDispatchPendingRef.current ||
      routeSwitching
    ) {
      return
    }
    if (selectedRouteUnavailable) {
      return
    }
    const hasAttachedImages = attachmentsRef.current.some((attachment) =>
      ATTACHMENT_IMAGE_EXTS.has(attachment.ext),
    )
    if (hasAttachedImages && !selectedModelSupportsImages) {
      setAttachNotice(IMAGE_UNSUPPORTED_NOTICE)
      return
    }
    setInput('')
    instructionRef.current = instruction
    lastInstructionRef.current = instruction
    runToolsRef.current = []
    stickToBottomRef.current = true
    setChat((prev) => [
      ...prev,
      { role: 'user', text: displayInstruction },
      { role: 'assistant', text: '', streaming: true },
    ])
    runStartedAtRef.current = Date.now()
    setBusy(true)
    runDispatchPendingRef.current = true
    activeRunRouteRef.current = route
    persistMessage('user', instruction, undefined, attachmentsRef.current)
    void routeWriteRef.current
      .then(() => collectImageAttachments())
      .then((images) => {
        if (images.length > 0) setConversationHasImages(true)
        loop.run(instruction, images)
      })
      .catch((error: unknown) => {
        runDispatchPendingRef.current = false
        setBusy(false)
        patchLastAssistant({
          streaming: false,
          error: error instanceof Error ? error.message : tModule('aiUnknownError'),
        })
      })
  }

  const cancel = () => loopRef.current?.cancel()

  const retry = () => runWith(lastInstructionRef.current)

  const retryWithRoute = async (route: AiRoute) => {
    const incoming = models.find(
      (model) => model.providerId === route.providerId && model.id === route.modelId,
    )
    if (!incoming) {
      setModelNotice('The suggested fallback is unavailable. Choose another model and retry.')
      return
    }
    const switched = await switchModel(toPickerModel(incoming, providers))
    if (switched) runWith(lastInstructionRef.current)
  }

  const continueRun = () => runWith(DOCS_CONTINUE_INSTRUCTION, t('aiContinue'))

  const newChat = () => {
    loopRef.current?.reset()
    setBusy(false)
    setChat([])
    inputRef.current?.focus()
  }

  const copyMessage = (text: string, idx: number) => {
    void navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    window.setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1200)
  }

  const mergeAttachments = (result: AttachmentAddResult | null) => {
    if (!result) return
    const blockedImages = selectedModelSupportsImages
      ? []
      : result.accepted.filter((attachment) => ATTACHMENT_IMAGE_EXTS.has(attachment.ext))
    const accepted = selectedModelSupportsImages
      ? result.accepted
      : result.accepted.filter((attachment) => !ATTACHMENT_IMAGE_EXTS.has(attachment.ext))
    if (accepted.length > 0) {
      setAttachments((prev) => {
        const seen = new Set(prev.map((a) => a.path))
        return [...prev, ...accepted.filter((a) => !seen.has(a.path))]
      })
    }
    const notices = [
      ...(blockedImages.length > 0 ? [IMAGE_UNSUPPORTED_NOTICE] : []),
      ...result.rejected,
    ]
    if (notices.length > 0) {
      setAttachNotice(notices.join('; '))
      window.setTimeout(() => setAttachNotice(null), 5000)
    }
  }

  const pickAttachments = async () => mergeAttachments(await window.desktop.pickAttachments())

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.desktop.getPathForFile(f))
      .filter(Boolean)
    if (paths.length > 0) mergeAttachments(await window.desktop.addAttachmentPaths(paths))
  }

  /** Files pasted into the input: ones with a local path go through regular attachments; pure bitmaps like screenshots hit a temp file first */
  const onPasteFiles = async (files: File[]) => {
    const paths: string[] = []
    for (const f of files) {
      if (f.type.startsWith('image/') && !selectedModelSupportsImages) {
        setAttachNotice(IMAGE_UNSUPPORTED_NOTICE)
        window.setTimeout(() => setAttachNotice(null), 5000)
        continue
      }
      const p = window.desktop.getPathForFile(f)
      if (p) {
        paths.push(p)
        continue
      }
      const ext = PASTE_MIME_EXT[f.type] ?? f.name.split('.').pop()?.toLowerCase() ?? 'bin'
      mergeAttachments(await window.desktop.addPastedImage(await f.arrayBuffer(), ext))
    }
    if (paths.length > 0) mergeAttachments(await window.desktop.addAttachmentPaths(paths))
  }

  const removeAttachment = (path: string) =>
    setAttachments((prev) => prev.filter((a) => a.path !== path))

  const acceptChanges = () => {
    applyRevisionsBy(editorRef.current, AI_REVISION_AUTHOR, 'accept')
    clearAiHighlights()
  }

  const toggleTrackChanges = () => {
    const next = !trackChanges
    setTrackChanges(next)
    localStorage.setItem(TRACK_CHANGES_KEY, next ? '1' : '0')
    // switching off keeps nothing pending: accept whatever is still highlighted
    if (!next) acceptChanges()
  }

  const rollback = (snapshot: Snapshot) => {
    editor.commands.setContent(snapshot.json as never)
    setSnapshots((prev) => prev.filter((s) => s !== snapshot))
  }

  /** drag the panel's right edge to resize; panel is flush with the window's left edge */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent) => {
      setPanelWidth(clampPanelWidth(ev.clientX))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setResizing(false)
      setPanelWidth((w) => {
        localStorage.setItem(PANEL_WIDTH_KEY, String(Math.round(w)))
        return w
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // collapsed: rail only — after all hooks, so the instance and its state survive
  if (!open) {
    return (
      <button className="ai-rail" title={t('appExpandAiPanel')} onClick={onExpand}>
        <AiMark size={22} />
      </button>
    )
  }

  return (
    <aside
      ref={asideRef}
      style={{ width: '100%' }}
      className={`ai-panel${dragOver ? ' ai-panel-dragover' : ''}${resizing ? ' ai-panel-resizing' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      <div
        className="ai-panel-resizer"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('aiPanelTitle')}
      />
      <div className="ai-panel-header">
        <span className="ai-panel-title">
          <AiMark size={22} />
          {t('aiPanelTitle')}
        </span>
        <div className="ai-panel-header-actions">
          {chat.length > 0 && (
            <button className="ai-header-btn" onClick={newChat} title={t('aiNewChatTitle')}>
              <IconNewChat size={16} />
            </button>
          )}
          {onCollapse && (
            <button className="ai-header-btn" onClick={onCollapse} title={t('aiCollapseTitle')}>
              <IconSidebarCollapse size={16} />
            </button>
          )}
        </div>
      </div>

      <div ref={logRef} className="ai-chat" onScroll={onLogScroll}>
        {/* past conversation (read-only transcript, not fed to the model), shown continuously with the current turn */}
        {historicChat.length > 0 && (
          <>
            {historicChat.map((entry, i) => (
              <div key={`h${i}`} className={`ai-msg ai-msg-${entry.role} ai-msg-historic`}>
                {entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />}
                {entry.text && <Markdown text={entry.text} />}
              </div>
            ))}
            <div className="ai-history-sep">{t('aiHistorySep')}</div>
          </>
        )}
        {chat.length === 0 && historicChat.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-title">
              {t(docEmpty ? 'aiEmptyDraftTitle' : 'aiEmptyTitle')}
            </div>
            <div className="ai-chat-empty-body">
              {t(docEmpty ? 'aiEmptyDraftBody1' : 'aiEmptyBody1')}
              <br />
              {t(docEmpty ? 'aiEmptyDraftBody2' : 'aiEmptyBody2')}
            </div>
            <div className="ai-starter-list">
              {(docEmpty ? DRAFT_STARTER_PROMPTS : EDIT_STARTER_PROMPTS).map((p) => (
                <button
                  key={p}
                  className="ai-starter"
                  onClick={() => {
                    setInput(t(p))
                    inputRef.current?.focus()
                  }}
                >
                  {t(p)}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((entry, i) => {
          if (entry.modelSwitch) {
            return (
              <div key={i} className="ai-model-switch-divider" role="status">
                <span>Switched to {entry.modelSwitch}</span>
              </div>
            )
          }
          if (
            entry.role === 'assistant' &&
            !entry.text &&
            !entry.streaming &&
            !entry.error &&
            !entry.tools?.length
          ) {
            return null
          }
          const isLast = i === chat.length - 1
          const retryModel = entry.retryRoute
            ? models.find(
                (model) =>
                  model.providerId === entry.retryRoute?.providerId &&
                  model.id === entry.retryRoute.modelId,
              )
            : undefined
          // Action row appears once per completed reply: on the turn's final segment only
          // (mid-turn segments have a following assistant entry; the live turn ends when !busy)
          const nextEntry = chat[i + 1]
          const turnEnded = nextEntry ? nextEntry.role === 'user' : !busy
          const showToolbar =
            entry.role === 'assistant' &&
            !entry.streaming &&
            turnEnded &&
            !!(entry.text || entry.error)
          return (
            <div
              key={i}
              className={`ai-msg ai-msg-${entry.role}${entry.role === 'assistant' && entry.streaming ? ' ai-msg-streaming' : ''}`}
            >
              {entry.role === 'assistant' && !entry.text && entry.streaming ? (
                <span className="ai-typing-row">
                  <AiTypingIndicator
                    label={entry.tools?.length ? t('aiWorking') : t('aiThinking')}
                  />
                </span>
              ) : entry.role === 'assistant' ? (
                <Markdown text={entry.text} />
              ) : (
                entry.text
              )}
              {entry.tools && entry.tools.length > 0 && <ToolChipList tools={entry.tools} />}
              {entry.error && (
                <div className="ai-msg-error">{t('aiErrorPrefix', { error: entry.error })}</div>
              )}
              {entry.retrySuggestion && (
                <div className="ai-model-retry-suggestion" role="status">
                  {entry.retrySuggestion}
                </div>
              )}
              {entry.retryRoute && retryModel && (
                <button
                  className="ai-retry-route-btn"
                  onClick={() => void retryWithRoute(entry.retryRoute!)}
                  disabled={busy || routeSwitching}
                >
                  Retry with {retryModel.name}
                </button>
              )}
              {entry.loginRequired && (
                <button className="ai-login-btn" onClick={() => void window.desktop.aiGskLogin()}>
                  {t('aiGskLoginBtn')}
                </button>
              )}
              {showToolbar && (
                <div className="ai-msg-toolbar">
                  {entry.text && (
                    <button
                      className="ai-msg-tool-btn"
                      onClick={() => copyMessage(entry.text, i)}
                      aria-label={t('aiCopyReplyTitle')}
                      data-tip={t('aiCopyReplyTitle')}
                    >
                      {copiedIdx === i ? (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                          <path
                            d="M14.6113 5.34253C16.0608 5.3428 17.2363 6.518 17.2363 7.96753V15.5066C17.2361 16.956 16.0607 18.1313 14.6113 18.1316H7.07227C5.62267 18.1316 4.44751 16.9561 4.44727 15.5066V7.96753C4.44732 6.51783 5.62255 5.34253 7.07227 5.34253H14.6113ZM7.07227 6.59253C6.31291 6.59253 5.69732 7.20819 5.69727 7.96753V15.5066C5.69751 16.2658 6.31302 16.8816 7.07227 16.8816H14.6113C15.3703 16.8813 15.9861 16.2656 15.9863 15.5066V7.96753C15.9863 7.20835 15.3705 6.5928 14.6113 6.59253H7.07227ZM10.0176 2.8689C10.3626 2.86905 10.6426 3.14882 10.6426 3.4939C10.6425 3.83888 10.3626 4.11874 10.0176 4.1189H4.59961C3.84022 4.1189 3.22461 4.73451 3.22461 5.4939V11.324C3.22433 11.6689 2.94461 11.949 2.59961 11.949C2.25461 11.949 1.97489 11.6689 1.97461 11.324V5.4939C1.97461 4.04415 3.14987 2.8689 4.59961 2.8689H10.0176Z"
                            fill="currentColor"
                          />
                        </svg>
                      )}
                    </button>
                  )}
                  {isLast && !busy && lastInstructionRef.current && (
                    <button
                      className="ai-msg-tool-btn"
                      onClick={retry}
                      aria-label={t('aiRegenerateTitle')}
                      data-tip={t('aiRegenerateTitle')}
                    >
                      <IconRefresh size={12} />
                    </button>
                  )}
                </div>
              )}
              {entry.turnLimit && isLast && !busy && (
                <button className="ai-continue-btn" onClick={continueRun}>
                  {t('aiContinue')}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {snapshots.length > 0 && (
        <div className="ai-versions">
          <div className="ai-versions-title">
            <IconClock size={12} />
            {t('aiSnapshotsTitle')}
          </div>
          {snapshots.map((s, i) => (
            <div key={i} className="ai-version-row">
              <span className="ai-version-label" title={s.label}>
                <span className="ai-version-time">{s.time}</span>
                {s.label}
              </span>
              <button className="ai-version-rollback" onClick={() => rollback(s)}>
                {t('aiRollback')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="ai-composer">
        {attachments.length > 0 && (
          <div className="ai-attachments">
            {attachments.map((a) => (
              <span key={a.path} className="ai-attachment-chip" title={a.path}>
                <IconPaperclip size={11} />
                {a.name}
                <button
                  className="ai-attachment-remove"
                  onClick={() => removeAttachment(a.path)}
                  title={t('aiRemoveAttachmentTitle')}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {attachNotice && <div className="ai-attach-notice">{attachNotice}</div>}
        {modelNotice && <div className="ai-model-notice">{modelNotice}</div>}
        {selectedRouteUnavailable && (
          <div className="ai-model-notice">
            {selectedRoute.modelId} is saved as this conversation&apos;s route, but it is no longer
            available or compatible. Choose another model before sending.
          </div>
        )}
        <AiComposer
          value={input}
          busy={busy}
          placeholder={t('aiInputPlaceholder')}
          hintIdle={t('aiHintIdle')}
          hintBusy={t('aiHintBusy')}
          hintIdleTitle={t('aiHintIdleTitle')}
          sendLabel={
            selectedRouteUnavailable ? 'Choose an available model before sending' : t('aiSend')
          }
          stopLabel={t('aiStop')}
          iconOnly
          sendIconEnabled={<img src={sendEnterOn} alt="" aria-hidden />}
          sendIconDisabled={<img src={sendEnterOff} alt="" aria-hidden />}
          stopIcon={<img src={sendStop} alt="" aria-hidden />}
          textareaRef={inputRef}
          onChange={setInput}
          onSend={run}
          onStop={cancel}
          onPasteFiles={(files) => void onPasteFiles(files)}
          footerStart={
            <>
              <button
                className="ai-attach-btn"
                onClick={pickAttachments}
                title={
                  selectedModelSupportsImages
                    ? t('aiAttachTitle')
                    : `${t('aiAttachTitle')} — images are unavailable for this model`
                }
              >
                <img src={attachIcon} alt="" aria-hidden />
              </button>
              <button
                className={`ai-track-btn${trackChanges ? ' on' : ''}`}
                onClick={toggleTrackChanges}
                title={trackChanges ? t('aiTrackOnTitle') : t('aiTrackOffTitle')}
              >
                <span className="ai-track-dot" aria-hidden />
                {t('aiTrackChanges')}
              </button>
              <ModelPicker
                models={pickerModels}
                selection={selectedRoute}
                onSelectionChange={selectModel}
                onOpen={refreshModelsForPicker}
                disabled={!routeReady || !selectedRoute}
                busy={busy || routeSwitching}
                placement="top"
                ariaLabel="Choose a model for this document conversation"
                placeholder={routeReady ? 'Select model' : 'Loading models…'}
                emptyLabel={
                  requiresImageModel
                    ? 'No compatible image models are configured'
                    : 'No compatible models are configured'
                }
              />
            </>
          }
        />
      </div>
    </aside>
  )
}

/** Tool row list (unified with slides/sheets): dot + summary; expandable details when there's output; arrow shows on hover */
/** Step-row status icons (timeline glyphs: 14px in a 20px slot, 1.6 stroke) */
function StepIcon({ status }: { status: 'running' | 'done' | 'error' }) {
  if (status === 'running') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6.5 3.5h11M6.5 20.5h11M8 3.5v3.2c0 2.6 4 4.2 4 5.3 0 1.1 4 2.7 4 5.3v3.2M16 3.5v3.2c0 2.6-4 4.2-4 5.3 0 1.1-4 2.7-4 5.3v3.2" />
      </svg>
    )
  }
  if (status === 'error') {
    return (
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.4 2.4 2.4 4.6-5" />
    </svg>
  )
}

/** Tool activity group: a single quiet summary row
 *  that auto-opens while tools run, auto-collapses into "Worked · N steps" when they finish,
 *  and a manual toggle that always wins. Rows inside are step rows with 1px connectors. */
function ToolChipList({ tools }: { tools: ToolActivity[] }) {
  const { t: tr } = useI18n()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [userOpen, setUserOpen] = useState<boolean | null>(null)

  const toggle = (j: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(j)) next.delete(j)
      else next.add(j)
      return next
    })
  }

  const anyRunning = tools.some((tool) => tool.running)
  const open = userOpen ?? anyRunning
  const label = anyRunning ? tr('aiGroupWorking') : tr('aiWorkedSteps', { n: tools.length })

  return (
    <div className="ai-work-group">
      <button
        type="button"
        className={`ai-work-group-summary${anyRunning ? ' running' : ''}`}
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
      >
        {anyRunning && !open && <span className="ai-tool-chip-spinner" aria-hidden />}
        <span className="ai-work-group-label">{label}</span>
        <span className={`ai-tool-chip-caret${open ? ' open' : ''}`} aria-hidden>
          ›
        </span>
      </button>
      <div className={`ai-work-group-body${open ? ' open' : ''}`}>
        <div className="ai-work-group-body-inner">
          {tools.map((tool, j) => {
            const hasOutput = !tool.running && !!tool.output
            const isOpen = expanded.has(j)
            const stepStatus = tool.running ? 'running' : tool.isError ? 'error' : 'done'
            return (
              <div key={j} className="ai-step-row">
                <span className={`ai-step-icon ${stepStatus}`} aria-hidden>
                  <StepIcon status={stepStatus} />
                </span>
                <div className="ai-step-content">
                  {hasOutput ? (
                    <button
                      type="button"
                      className="ai-step-title clickable"
                      title={tool.name}
                      aria-expanded={isOpen}
                      onClick={() => toggle(j)}
                    >
                      {tool.summary}
                    </button>
                  ) : (
                    <span className="ai-step-title" title={tool.name}>
                      {tool.summary}
                    </span>
                  )}
                  {hasOutput && isOpen && (
                    <div className="ai-step-detail">
                      <div className="ai-tool-output">
                        <div className="ai-tool-output-pre">{tool.output}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
