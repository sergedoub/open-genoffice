import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  filterModelPickerModels,
  findModelPickerSelection,
  groupModelPickerModels,
  isModelPickerSelection,
  modelPickerKey,
  MODEL_PICKER_PROVIDER_ORDER,
  nextModelPickerIndex,
  type ModelPickerModel,
  type ModelPickerSelection,
} from './model-picker'
import './ModelPicker.css'

export interface ModelPickerProps {
  readonly models: readonly ModelPickerModel[]
  readonly selection: ModelPickerSelection | null
  readonly onSelectionChange: (model: ModelPickerModel) => void
  readonly onOpen?: (() => void) | undefined
  readonly disabled?: boolean | undefined
  readonly busy?: boolean | undefined
  readonly ariaLabel?: string | undefined
  readonly placeholder?: string | undefined
  readonly searchPlaceholder?: string | undefined
  readonly emptyLabel?: string | undefined
  readonly busyLabel?: string | undefined
  readonly manageProvidersLabel?: string | undefined
  readonly onManageProviders?: (() => void) | undefined
  readonly placement?: 'top' | 'bottom' | undefined
  readonly matchTriggerWidth?: boolean | undefined
}

interface PopoverPosition {
  readonly left: number
  readonly width: number
  readonly top?: number
  readonly bottom?: number
}

function ChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  )
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.2 10.2 3 3" />
    </svg>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3 8.4 3.1 3.1L13 4.7" />
    </svg>
  )
}

const BUNDLE_PROVIDER_IDS = new Set(['genspark'])

export function ModelPicker({
  models,
  selection,
  onSelectionChange,
  onOpen,
  disabled = false,
  busy = false,
  ariaLabel = 'Choose model',
  placeholder = 'Select model',
  searchPlaceholder = 'Search models',
  emptyLabel = 'No matching models',
  busyLabel = 'Model unavailable while generating',
  manageProvidersLabel = 'Manage providers…',
  onManageProviders,
  placement = 'top',
  matchTriggerWidth = false,
}: ModelPickerProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    () => new Set(BUNDLE_PROVIDER_IDS),
  )
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const selectedModel = findModelPickerSelection(models, selection)
  const filteredModels = useMemo(() => filterModelPickerModels(models, query), [models, query])
  const groups = useMemo(
    () => groupModelPickerModels(filteredModels, MODEL_PICKER_PROVIDER_ORDER),
    [filteredModels],
  )
  const visibleModels = useMemo(() => {
    const searching = query.trim().length > 0
    return groups.flatMap((group) => {
      const expanded =
        BUNDLE_PROVIDER_IDS.has(group.providerId) ||
        searching ||
        expandedProviders.has(group.providerId)
      if (!expanded) return []
      // GenSpark is intentionally represented by one vanilla bundle choice;
      // its underlying catalog stays untouched for the runtime route.
      return group.providerId === 'genspark' ? group.models.slice(0, 1) : group.models
    })
  }, [expandedProviders, groups, query])
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null)
  const unavailable = disabled || busy
  const hasMenuContent = models.length > 0 || onManageProviders != null || onOpen != null

  const updatePopoverPosition = useCallback((): void => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const availableWidth = Math.max(0, window.innerWidth - 24)
    const popoverWidth = Math.min(matchTriggerWidth ? rect.width : 340, availableWidth)
    const maxLeft = Math.max(12, window.innerWidth - popoverWidth - 12)
    const left = Math.min(Math.max(12, rect.left), maxLeft)
    if (placement === 'top') {
      setPopoverPosition({
        left,
        width: popoverWidth,
        bottom: Math.max(12, window.innerHeight - rect.top + 8),
      })
    } else {
      setPopoverPosition({
        left,
        width: popoverWidth,
        top: Math.min(window.innerHeight - 12, rect.bottom + 8),
      })
    }
  }, [matchTriggerWidth, placement])

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPopoverPosition(null)
    setQuery('')
    setActiveIndex(-1)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const show = (): void => {
    if (unavailable || !hasMenuContent) return
    onOpen?.()
    setOpen(true)
    setPopoverPosition(null)
    setQuery('')
    setExpandedProviders(new Set(BUNDLE_PROVIDER_IDS))
    const selectedIndex = selection
      ? visibleModels.findIndex((model) => isModelPickerSelection(model, selection))
      : -1
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePopoverPosition()
    const onViewportChange = (): void => updatePopoverPosition()
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, updatePopoverPosition])

  const choose = (model: ModelPickerModel): void => {
    onSelectionChange(model)
    close(true)
  }

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => searchRef.current?.focus())

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) close()
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    if (visibleModels.length === 0) {
      setActiveIndex(-1)
      return
    }

    const selectedIndex = selection
      ? visibleModels.findIndex((model) => isModelPickerSelection(model, selection))
      : -1
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }, [open, selection, visibleModels])

  useEffect(() => {
    if (unavailable && open) close()
  }, [open, unavailable])

  const activeModel = activeIndex >= 0 ? visibleModels[activeIndex] : undefined
  const activeOptionId = activeModel
    ? `${baseId}-option-${encodeURIComponent(modelPickerKey(activeModel))}`
    : undefined

  useEffect(() => {
    if (!activeOptionId) return
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeOptionId])

  const toggleProvider = (providerId: string): void => {
    if (BUNDLE_PROVIDER_IDS.has(providerId)) return
    setExpandedProviders((previous) => {
      const next = new Set(previous)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
  }

  return (
    <div
      ref={rootRef}
      className={`model-picker model-picker--${placement}`}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null
        if (
          open &&
          !event.currentTarget.contains(nextTarget) &&
          !popoverRef.current?.contains(nextTarget)
        )
          close()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault()
          close(true)
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="model-picker__trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={unavailable || !hasMenuContent}
        title={busy ? busyLabel : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show()
          }
        }}
      >
        {selectedModel?.providerIcon && (
          <span className="model-picker__provider-icon">{selectedModel.providerIcon}</span>
        )}
        <span className="model-picker__trigger-label">
          {selectedModel?.shortLabel ?? selectedModel?.label ?? placeholder}
        </span>
        {busy && <span className="model-picker__busy-dot" aria-hidden="true" />}
        <span className="model-picker__chevron">
          <ChevronIcon />
        </span>
      </button>

      {open &&
        popoverPosition &&
        createPortal(
          <div
            ref={popoverRef}
            className={`model-picker__popover model-picker__popover--${placement}`}
            style={popoverPosition}
          >
            <div className="model-picker__search-wrap">
              <span className="model-picker__search-icon">
                <SearchIcon />
              </span>
              <input
                ref={searchRef}
                className="model-picker__search"
                type="text"
                role="combobox"
                aria-label={searchPlaceholder}
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={activeOptionId}
                autoComplete="off"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    setActiveIndex((current) =>
                      nextModelPickerIndex(
                        current,
                        visibleModels.length,
                        event.key === 'ArrowDown' ? 1 : -1,
                      ),
                    )
                  } else if (event.key === 'Home' && visibleModels.length > 0) {
                    event.preventDefault()
                    setActiveIndex(0)
                  } else if (event.key === 'End' && visibleModels.length > 0) {
                    event.preventDefault()
                    setActiveIndex(visibleModels.length - 1)
                  } else if (event.key === 'Enter' && activeModel) {
                    event.preventDefault()
                    choose(activeModel)
                  }
                }}
              />
            </div>

            <div id={listboxId} className="model-picker__listbox" role="listbox">
              {groups.length === 0 ? (
                <div className="model-picker__empty" role="status">
                  {emptyLabel}
                </div>
              ) : (
                groups.map((group) => (
                  <div
                    key={group.providerId}
                    className={`model-picker__group${BUNDLE_PROVIDER_IDS.has(group.providerId) ? ' model-picker__group--bundle' : ''}`}
                    role="group"
                    aria-label={group.providerLabel}
                  >
                    {!BUNDLE_PROVIDER_IDS.has(group.providerId) && (
                      <button
                        type="button"
                        className={`model-picker__group-header${expandedProviders.has(group.providerId) ? ' is-expanded' : ''}`}
                        aria-expanded={
                          expandedProviders.has(group.providerId) || query.trim().length > 0
                        }
                        aria-controls={`${listboxId}-${encodeURIComponent(group.providerId)}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => toggleProvider(group.providerId)}
                      >
                        <span className="model-picker__group-label">{group.providerLabel}</span>
                        <span
                          className={`model-picker__group-chevron${expandedProviders.has(group.providerId) || query.trim().length > 0 ? ' is-expanded' : ''}`}
                          aria-hidden="true"
                        >
                          <ChevronIcon />
                        </span>
                      </button>
                    )}
                    <div
                      id={`${listboxId}-${encodeURIComponent(group.providerId)}`}
                      className="model-picker__group-options"
                      hidden={
                        !BUNDLE_PROVIDER_IDS.has(group.providerId) &&
                        !expandedProviders.has(group.providerId) &&
                        query.trim().length === 0
                      }
                    >
                      {(group.providerId === 'genspark'
                        ? group.models.slice(0, 1)
                        : group.models
                      ).map((model) => {
                        const flatIndex = visibleModels.indexOf(model)
                        const selected = isModelPickerSelection(model, selection)
                        const optionId = `${baseId}-option-${encodeURIComponent(modelPickerKey(model))}`
                        return (
                          <div
                            id={optionId}
                            key={modelPickerKey(model)}
                            className={`model-picker__option${flatIndex === activeIndex ? ' is-active' : ''}`}
                            role="option"
                            aria-selected={selected}
                            onPointerMove={() => setActiveIndex(flatIndex)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => choose(model)}
                          >
                            <span className="model-picker__option-icon" aria-hidden="true">
                              {model.providerIcon}
                            </span>
                            <span className="model-picker__option-copy">
                              <span className="model-picker__option-label">
                                {group.providerId === 'genspark'
                                  ? group.providerLabel
                                  : model.label}
                              </span>
                            </span>
                            <span className="model-picker__check" aria-hidden="true">
                              {selected && <CheckIcon />}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
            {onManageProviders && (
              <button
                type="button"
                className="model-picker__manage"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  close()
                  onManageProviders()
                }}
              >
                {manageProvidersLabel}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

export type { ModelPickerModel, ModelPickerSelection }
