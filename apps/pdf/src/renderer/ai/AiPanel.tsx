import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react'
import { AgentLoop } from '@genoffice/agent-core'
import type { AgentTransport } from '@genoffice/agent-core'
import {
  openRouterRetrySuggestion,
  type AiModelSummary,
  type AiRoute,
} from '@genoffice/ai-provider'
import { AiComposer, AiTypingIndicator, Markdown, ModelPicker } from '@genoffice/ui'
import type { ModelPickerModel } from '@genoffice/ui'
import { aiLangDirective, t as tGlobal, useI18n } from '../i18n/locale'
import type {
  AiConversationIdentity,
  ProjectToolActivity,
  PublicAiProvider,
} from '../../shared/ipc'
import sendEnterOn from '../assets/send-enter-on.png'
import sendEnterOff from '../assets/send-enter-off.png'
import sendStop from '../assets/send-stop.png'
import {
  isPdfCompatibleModel,
  latestTranscriptRoute,
  modelCompactionBudget,
  restorePdfTranscript,
  routeEquals,
  toPickerModel,
} from './model-routing'
import { createPdfSkill } from './pdf-skill'
import { createElectronTransport } from './transport'
import type { PdfAiDeps } from './tools'

const PANEL_WIDTH_KEY = 'pdf-ai-panel-width'
const PANEL_WIDTH_DEFAULT = 540
const PANEL_WIDTH_MIN = 280

function clampPanelWidth(w: number): number {
  return Math.min(Math.max(w, PANEL_WIDTH_MIN), Math.min(720, Math.round(window.innerWidth * 0.6)))
}

function loadPanelWidth(): number {
  const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  return Number.isFinite(saved) && saved > 0 ? clampPanelWidth(saved) : PANEL_WIDTH_DEFAULT
}

interface ToolActivity {
  name: string
  summary: string
  isError?: boolean
  output?: string
}

interface MessageChatEntry {
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
  isError?: boolean
  /** A failed model turn may be retried through OpenRouter's router. */
  retrySuggestion?: string
  /** the run failed and this user message was rolled back out of the model context */
  undelivered?: boolean
  tools?: ToolActivity[]
}

type ChatEntry = MessageChatEntry | { role: 'divider'; text: string }

type Phase = 'thinking' | 'replying' | 'working'

export function AiPanel({
  api,
  filePath,
  onCollapse,
}: {
  api: PdfAiDeps
  filePath: string | null
  onCollapse: () => void
}): ReactElement {
  const { lang, t } = useI18n()
  const [chat, setChat] = useState<ChatEntry[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<Phase>('thinking')
  const chatRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)
  const [panelWidth, setPanelWidth] = useState(loadPanelWidth)
  const [resizing, setResizing] = useState(false)
  const asideRef = useRef<HTMLElement>(null)
  const [providers, setProviders] = useState<PublicAiProvider[]>([])
  const [models, setModels] = useState<AiModelSummary[]>([])
  const modelsRef = useRef<AiModelSummary[]>([])
  modelsRef.current = models
  const [selectedRoute, setSelectedRoute] = useState<AiRoute | null>(null)
  const [routeReady, setRouteReady] = useState(false)
  const [routeValidated, setRouteValidated] = useState(false)
  const [routeSwitching, setRouteSwitching] = useState(false)
  const [modelNotice, setModelNotice] = useState<string | null>(null)
  const conversationRef = useRef<AiConversationIdentity | null>(null)
  const routeRef = useRef<AiRoute | null>(null)
  const routeWriteRef = useRef<Promise<void>>(Promise.resolve())
  const activeRunRouteRef = useRef<AiRoute | null>(null)
  const modelRefreshRequestRef = useRef(0)
  const runToolsRef = useRef<ProjectToolActivity[]>([])
  const runDispatchPendingRef = useRef(false)

  // The .ai-dock wrapper owns the animated width (docs-style 180ms slide);
  // it tracks the resizable panel width through this variable
  useEffect(() => {
    const dock = asideRef.current?.closest('.ai-dock') as HTMLElement | null
    dock?.style.setProperty('--ai-panel-width', `${panelWidth}px`)
  }, [panelWidth])
  const langRef = useRef(lang)
  langRef.current = lang
  const apiRef = useRef(api)
  apiRef.current = api

  const patchLast = (
    patch: Partial<MessageChatEntry> | ((last: MessageChatEntry) => Partial<MessageChatEntry>),
  ) => {
    setChat((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') return prev
      next[next.length - 1] = {
        ...last,
        ...(typeof patch === 'function' ? patch(last) : patch),
      }
      return next
    })
  }

  const persistMessage = (
    role: 'user' | 'assistant',
    text: string,
    tools?: ProjectToolActivity[],
    route?: AiRoute | null,
  ): void => {
    const identity = conversationRef.current
    if (!identity) return
    void window.pdfApi
      .appendProjectChat({
        ...identity,
        role,
        text,
        ...(tools?.length ? { tools } : {}),
        ...(role === 'assistant' && route ? { ai: { requested: route } } : {}),
      })
      .catch(() => {
        /* Persistence failure must not interrupt the active editing run. */
      })
  }

  const transportRef = useRef<AgentTransport | null>(null)
  if (!transportRef.current) {
    transportRef.current = createElectronTransport(() => conversationRef.current ?? undefined)
  }

  // The loop is built once; every mutable value goes through a ref getter
  const loopRef = useRef<AgentLoop | null>(null)
  if (!loopRef.current) {
    const deps: PdfAiDeps = {
      doc: () => apiRef.current.doc(),
      fileName: () => apiRef.current.fileName(),
      pageCount: () => apiRef.current.pageCount(),
      currentPage: () => apiRef.current.currentPage(),
      readOnly: () => apiRef.current.readOnly(),
      outline: () => apiRef.current.outline(),
      searchIndex: () => apiRef.current.searchIndex(),
      isDeleted: (i) => apiRef.current.isDeleted(i),
      gotoPage: (p) => apiRef.current.gotoPage(p),
      addMarkup: (type, idx, rects) => apiRef.current.addMarkup(type, idx, rects),
      formEdits: () => apiRef.current.formEdits(),
      applyFormEdit: (v) => apiRef.current.applyFormEdit(v),
      rotatePage: (idx, dir) => apiRef.current.rotatePage(idx, dir),
      deletePage: (idx) => apiRef.current.deletePage(idx),
    }
    loopRef.current = new AgentLoop({
      transport: transportRef.current,
      skill: createPdfSkill(deps),
      systemSuffix: () => aiLangDirective(langRef.current),
      events: {
        onText: (text) => {
          setPhase('replying')
          patchLast({ text })
        },
        onToolExecuted: ({ call, execution }) => {
          setPhase('working')
          runToolsRef.current.push({
            name: call.name,
            summary: execution.summary,
            isError: execution.isError,
            output: execution.output?.slice(0, 10_000),
          })
          patchLast((last) => ({
            tools: [
              ...(last.tools ?? []),
              {
                name: call.name,
                summary: execution.summary,
                isError: execution.isError,
                output: execution.output?.slice(0, 2000),
              },
            ],
          }))
        },
        onTurnEnd: () => {
          setPhase('thinking')
          patchLast({ streaming: false })
          setChat((prev) => [...prev, { role: 'assistant', text: '', streaming: true }])
        },
        onDone: ({ text, cancelled, turnLimit }) => {
          const final = turnLimit
            ? [text, tGlobal('aiTurnLimit')].filter(Boolean).join('\n\n')
            : text || (cancelled ? tGlobal('aiStopped') : '')
          patchLast((last) => ({
            streaming: false,
            text: final || (last.tools?.length ? last.text : tGlobal('aiNoReply')),
          }))
          setBusy(false)
          runDispatchPendingRef.current = false
          if (final && !cancelled) {
            persistMessage('assistant', final, runToolsRef.current, activeRunRouteRef.current)
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
                text: error,
                isError: true,
                retrySuggestion: failedRoute
                  ? openRouterRetrySuggestion(failedRoute, failedModel)
                  : undefined,
              }
            }
            return next
          })
          setBusy(false)
          runDispatchPendingRef.current = false
        },
      },
    })
  }

  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    setRouteReady(false)
    setRouteValidated(false)
    setModelNotice(null)
    void (async () => {
      try {
        const [identity, settings, catalog] = await Promise.all([
          window.pdfApi.resolveProjectChat({ filePath }),
          window.pdfApi.getAiPublicSettings(),
          window.pdfApi.listAiModels(),
        ])
        const messages = await window.pdfApi.loadProjectChat({ ...identity, limit: 200 })
        let route: AiRoute
        let routeReadError: string | null = null
        try {
          route = await window.pdfApi.getAiConversationRoute(identity)
        } catch (error) {
          // The validated getter rejects expired or unavailable routes. Keep
          // stored response provenance visible, but never enable sending.
          route = latestTranscriptRoute(messages) ?? settings.globalDefault
          routeReadError = error instanceof Error ? error.message : String(error)
        }
        if (cancelled) return
        conversationRef.current = identity
        routeRef.current = route
        setSelectedRoute(route)
        setRouteValidated(routeReadError === null)
        setProviders(settings.providers)
        const compatible = catalog.models.filter(isPdfCompatibleModel)
        setModels(compatible)
        if (
          routeReadError ||
          !compatible.some((model) =>
            routeEquals(route, { providerId: model.providerId, modelId: model.id }),
          )
        ) {
          setModelNotice(
            routeReadError ??
              `The selected model (${route.modelId}) is unavailable. Choose a compatible replacement before sending.`,
          )
        }
        loopRef.current?.reset()
        loopRef.current?.restore(
          messages.map((message) => ({ role: message.role, text: message.text })),
        )
        setChat(restorePdfTranscript(messages) as ChatEntry[])
        setRouteReady(true)
      } catch (error) {
        if (cancelled) return
        setRouteReady(true)
        setRouteValidated(false)
        setModelNotice(
          error instanceof Error
            ? error.message
            : 'Model selection is temporarily unavailable for this PDF.',
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [filePath])

  useEffect(() => {
    if (stickToBottomRef.current) {
      chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight })
    }
  }, [chat, busy])

  const onChatScroll = (): void => {
    const el = chatRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  const refreshModelsForPicker = (): void => {
    const requestId = ++modelRefreshRequestRef.current
    void Promise.all([window.pdfApi.getAiPublicSettings(), window.pdfApi.listAiModels()])
      .then(([settings, catalog]) => {
        if (requestId !== modelRefreshRequestRef.current) return
        setProviders(settings.providers)
        setModels(catalog.models.filter(isPdfCompatibleModel))
      })
      .catch(() => undefined)
  }

  const send = (text: string): void => {
    const instruction = text.trim()
    const loop = loopRef.current
    const route = routeRef.current
    const routeAvailable =
      routeValidated &&
      models.some(
        (model) =>
          isPdfCompatibleModel(model) &&
          model.providerId === route?.providerId &&
          model.id === route.modelId,
      )
    if (!routeAvailable) {
      setModelNotice('Choose an available compatible model before sending.')
      return
    }
    if (
      !instruction ||
      !loop ||
      !route ||
      !conversationRef.current ||
      loop.busy ||
      routeSwitching ||
      runDispatchPendingRef.current
    ) {
      return
    }
    stickToBottomRef.current = true
    setChat((prev) => [
      ...prev,
      { role: 'user', text: instruction },
      { role: 'assistant', text: '', streaming: true },
    ])
    setPrompt('')
    setBusy(true)
    setPhase('thinking')
    runToolsRef.current = []
    runDispatchPendingRef.current = true
    activeRunRouteRef.current = route
    persistMessage('user', instruction)
    void routeWriteRef.current
      .then(() => loop.run(instruction))
      .catch((err: unknown) => {
        patchLast({
          streaming: false,
          text: err instanceof Error ? err.message : String(err),
          isError: true,
        })
        setBusy(false)
        runDispatchPendingRef.current = false
      })
  }

  const selectModel = (picked: ModelPickerModel): void => {
    const identity = conversationRef.current
    const incoming = models.find(
      (model) => model.providerId === picked.providerId && model.id === picked.modelId,
    )
    if (!identity || !incoming || busy || routeSwitching) return
    const route: AiRoute = { providerId: incoming.providerId, modelId: incoming.id }
    if (routeEquals(routeRef.current, route)) return

    setRouteSwitching(true)
    setModelNotice(null)
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
        const validatedRoute = await window.pdfApi.setAiConversationRoute(identity, route)
        preparation?.commit()
        routeRef.current = validatedRoute
        setSelectedRoute(validatedRoute)
        setRouteValidated(true)
        setChat((previous) =>
          previous.length > 0
            ? [...previous, { role: 'divider', text: `Switched to ${incoming.name}` }]
            : previous,
        )
      } catch (error) {
        preparation?.rollback()
        throw error
      }
    })()
      .catch((error: unknown) => {
        setModelNotice(error instanceof Error ? error.message : 'Could not change models.')
      })
      .finally(() => setRouteSwitching(false))
  }

  const stop = (): void => loopRef.current?.cancel()

  // Re-clamp the persisted width when the window shrinks (max is 60% of the window)
  useEffect(() => {
    const onResize = (): void => setPanelWidth((w) => clampPanelWidth(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /** Drag the right edge to resize: the panel is flush with the window's left edge, so width = clientX */
  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setResizing(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: PointerEvent): void => {
      setPanelWidth(clampPanelWidth(ev.clientX))
    }
    const onUp = (): void => {
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

  const typingLabel =
    phase === 'replying' ? t('aiReplying') : phase === 'working' ? t('aiWorking') : t('aiThinking')

  const selectedModel = selectedRoute
    ? models.find(
        (model) =>
          model.providerId === selectedRoute.providerId && model.id === selectedRoute.modelId,
      )
    : undefined
  const routeAvailable =
    routeValidated && selectedModel != null && isPdfCompatibleModel(selectedModel)
  const pickerModels = models
    .filter(isPdfCompatibleModel)
    .map((model) => toPickerModel(model, providers))

  return (
    <aside
      ref={asideRef}
      className={`copilot${resizing ? ' ai-panel-resizing' : ''}`}
      style={{ width: '100%' }}
    >
      <div
        className="ai-panel-resizer"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="AI"
      />
      <header className="ai-panel-header">
        <span className="ai-panel-title">
          <AiMark size={22} />
          Genspark
        </span>
        <div className="ai-panel-header-actions">
          {chat.length > 0 && (
            <button
              className="ai-header-btn"
              onClick={() => {
                stop()
                loopRef.current?.reset()
                setBusy(false)
                setChat([])
              }}
              title={t('aiNewChat')}
            >
              <IconNewChat />
            </button>
          )}
          <button className="ai-header-btn" onClick={onCollapse} title={t('aiCollapsePanel')}>
            <IconCollapse />
          </button>
        </div>
      </header>

      <div className="ai-chat" ref={chatRef} onScroll={onChatScroll}>
        {chat.length === 0 && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-title">{t('aiEmptyTitle')}</div>
            <div className="ai-chat-empty-body">{t('aiEmptyBody')}</div>
            <div className="ai-quick-actions">
              <button className="ai-quick-btn" onClick={() => send(t('aiQuickSummaryPrompt'))}>
                {t('aiQuickSummary')}
              </button>
              <button className="ai-quick-btn" onClick={() => send(t('aiQuickKeyPointsPrompt'))}>
                {t('aiQuickKeyPoints')}
              </button>
            </div>
          </div>
        )}
        {chat.map((entry, i) => {
          if (entry.role === 'divider') {
            return (
              <div key={i} className="ai-model-switch-divider" role="separator">
                <span>{entry.text}</span>
              </div>
            )
          }
          if (entry.role === 'user') {
            return (
              <div key={i} className="ai-msg ai-msg-user">
                {entry.text}
              </div>
            )
          }
          const hasTools = (entry.tools?.length ?? 0) > 0
          if (!entry.text && !hasTools) return null
          return (
            <div
              key={i}
              className={`ai-msg ai-msg-assistant${entry.isError ? ' ai-msg-error' : ''}`}
            >
              {hasTools && <ToolChipList tools={entry.tools!} />}
              {entry.text && <Markdown text={entry.text} />}
              {entry.retrySuggestion && (
                <div className="ai-model-retry-suggestion" role="status">
                  {entry.retrySuggestion}
                </div>
              )}
            </div>
          )
        })}
        {/* In-progress state: a standalone three-dot row at the end of the stream, kept until done */}
        {busy && <AiTypingIndicator label={typingLabel} />}
      </div>

      <div className="ai-composer">
        {modelNotice && <div className="ai-model-notice">{modelNotice}</div>}
        {!routeAvailable && selectedRoute && (
          <div className="ai-model-capability-note">
            {selectedRoute.modelId} is retained for this conversation but cannot be used for a new
            prompt. Choose another model.
          </div>
        )}
        <div className={!routeAvailable ? 'ai-route-blocked' : undefined}>
          <AiComposer
            value={prompt}
            busy={busy}
            placeholder={t('aiComposerPlaceholder')}
            hintIdle={t('aiHintIdle')}
            hintBusy={t('aiHintBusy')}
            sendLabel={t('aiSend')}
            stopLabel={t('aiStop')}
            iconOnly
            sendIconEnabled={<img src={sendEnterOn} alt="" aria-hidden />}
            sendIconDisabled={<img src={sendEnterOff} alt="" aria-hidden />}
            stopIcon={<img src={sendStop} alt="" aria-hidden />}
            onChange={setPrompt}
            onSend={() => send(prompt)}
            onStop={stop}
            footerStart={
              <ModelPicker
                models={pickerModels}
                selection={selectedRoute}
                onSelectionChange={selectModel}
                onOpen={refreshModelsForPicker}
                disabled={!routeReady}
                busy={busy || routeSwitching}
                placement="top"
                ariaLabel="Choose a model for this PDF conversation"
                placeholder={
                  selectedRoute && !selectedModel
                    ? `Unavailable: ${selectedRoute.modelId}`
                    : routeReady
                      ? 'Select model'
                      : 'Loading models…'
                }
                emptyLabel="No compatible models are configured"
              />
            }
          />
        </div>
      </div>
    </aside>
  )
}

/** Tool row list (unified with docs/slides/sheets): dot + summary, expandable details when there's output */
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

  const open = userOpen ?? false
  const label = tr('aiWorkedSteps', { n: tools.length })

  return (
    <div className="ai-work-group">
      <button
        type="button"
        className={`ai-work-group-summary`}
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
      >
        <span className="ai-work-group-label">{label}</span>
        <span className={`ai-tool-chip-caret${open ? ' open' : ''}`} aria-hidden>
          ›
        </span>
      </button>
      <div className={`ai-work-group-body${open ? ' open' : ''}`}>
        <div className="ai-work-group-body-inner">
          {tools.map((tool, j) => {
            const hasOutput = !!tool.output
            const isOpen = expanded.has(j)
            const stepStatus = tool.isError ? 'error' : 'done'
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

function Svg({ children }: { children: React.ReactNode }): ReactElement {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden
    >
      {children}
    </svg>
  )
}

function IconNewChat(): ReactElement {
  return (
    <Svg>
      <path
        d="M13.5 7.2v-3A1.7 1.7 0 0 0 11.8 2.5H4.2a1.7 1.7 0 0 0-1.7 1.7v6.1a1.7 1.7 0 0 0 1.7 1.7h1.1v2l2.6-2h1.3"
        strokeLinejoin="round"
      />
      <path d="M12.2 9.4v4M10.2 11.4h4" />
    </Svg>
  )
}

/* Same glyph as the slides IconSidebarCollapse (24×24 viewBox, 1.5 stroke), rendered at 15px */
function IconCollapse(): ReactElement {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Mirrored: the AI panel docks on the LEFT, so the divider and arrow point left */}
      <rect x="2.25" y="3.75" width="19.5" height="16.5" rx="1.5" />
      <path d="M8.25 3.75 v16.5" />
      <path d="M18.75 12 h-6.6 M14.7 8.85 11.55 12 l3.15 3.15" />
    </svg>
  )
}

/** Neutral AI mark for the private provider-enabled build. */
export function AiMark({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 130 130"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect width="130" height="130" rx="24" fill="#111" />
      <text
        x="65"
        y="82"
        fill="#fff"
        fontFamily="Arial, sans-serif"
        fontSize="58"
        fontWeight="700"
        textAnchor="middle"
      >
        AI
      </text>
    </svg>
  )
}
