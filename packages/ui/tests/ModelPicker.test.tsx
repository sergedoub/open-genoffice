// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelPicker } from '../src/ModelPicker'
import type { ModelPickerModel } from '../src/model-picker'

const models: readonly ModelPickerModel[] = [
  {
    providerId: 'genspark',
    providerLabel: 'Genspark',
    modelId: 'claude-opus-4-7',
    label: 'claude-opus-4-7',
    shortLabel: 'Genspark',
  },
  {
    providerId: 'openrouter',
    providerLabel: 'OpenRouter',
    modelId: 'anthropic/claude-sonnet-4',
    label: 'Claude Sonnet 4',
    shortLabel: 'Sonnet 4',
    description: '200K context',
    capabilityLabels: ['Vision', 'Tools'],
  },
  {
    providerId: 'openai',
    providerLabel: 'OpenAI',
    modelId: 'gpt-5',
    label: 'GPT-5',
    capabilityLabels: ['Tools'],
  },
  {
    providerId: 'anthropic',
    providerLabel: 'Anthropic',
    modelId: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
  },
]

describe('ModelPicker', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  function renderPicker(overrides: Partial<React.ComponentProps<typeof ModelPicker>> = {}): void {
    act(() => {
      root.render(
        <ModelPicker
          models={models}
          selection={{ providerId: 'genspark', modelId: 'claude-opus-4-7' }}
          onSelectionChange={() => undefined}
          {...overrides}
        />,
      )
    })
  }

  async function openPicker(): Promise<void> {
    const trigger = container.querySelector<HTMLButtonElement>('.model-picker__trigger')
    expect(trigger).not.toBeNull()
    await act(async () => {
      trigger?.click()
      await new Promise(requestAnimationFrame)
    })
  }

  it('exposes a labelled trigger and grouped, selected options', async () => {
    renderPicker({ ariaLabel: 'Model for this document' })

    const trigger = container.querySelector<HTMLButtonElement>('.model-picker__trigger')
    expect(trigger?.getAttribute('aria-label')).toBe('Model for this document')
    expect(trigger?.getAttribute('title')).toBeNull()
    expect(trigger?.getAttribute('aria-haspopup')).toBe('listbox')
    expect(trigger?.textContent).toContain('Genspark')

    await openPicker()

    expect(trigger?.getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelectorAll('[role="group"]')).toHaveLength(4)
    expect(document.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Genspark')
    const selectedOption = document.querySelector('[role="option"][aria-selected="true"]')
    expect(selectedOption?.textContent).toContain('Genspark')
    expect(selectedOption?.textContent).not.toContain('200K context')
    expect(selectedOption?.textContent).not.toContain('Vision')
    expect(selectedOption?.querySelector('.model-picker__option-meta')).toBeNull()
  })

  it('keeps provider categories collapsed while leaving the single Genspark bundle visible', async () => {
    renderPicker({ selection: { providerId: 'genspark', modelId: 'claude-opus-4-7' } })
    await openPicker()

    const openRouter = document.querySelector<HTMLButtonElement>('.model-picker__group-header')
    expect(openRouter?.getAttribute('aria-expanded')).toBe('false')
    expect(
      document.querySelectorAll('.model-picker__group-options:not([hidden]) [role="option"]'),
    ).toHaveLength(1)

    act(() => openRouter?.click())
    expect(openRouter?.getAttribute('aria-expanded')).toBe('true')
    expect(openRouter?.classList.contains('is-expanded')).toBe(true)
    expect(
      document.querySelectorAll('.model-picker__group-options:not([hidden]) [role="option"]'),
    ).toHaveLength(2)

    act(() => openRouter?.click())
    expect(openRouter?.getAttribute('aria-expanded')).toBe('false')
    expect(openRouter?.classList.contains('is-expanded')).toBe(false)
  })

  it('expands categories when searching for a provider or model', async () => {
    renderPicker({ selection: { providerId: 'genspark', modelId: 'claude-opus-4-7' } })
    await openPicker()

    const search = document.querySelector<HTMLInputElement>('[role="combobox"]')
    act(() => {
      if (search) {
        const setNativeValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )?.set
        setNativeValue?.call(search, 'GPT-5')
        search.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    expect(
      document.querySelectorAll('.model-picker__group-options:not([hidden]) [role="option"]'),
    ).toHaveLength(1)
    expect(
      document.querySelector('.model-picker__group-options:not([hidden]) [role="option"]')
        ?.textContent,
    ).toContain('GPT-5')
  })

  it('renders the popover in the document layer and matches the trigger when requested', async () => {
    renderPicker({ placement: 'bottom', matchTriggerWidth: true })
    const trigger = container.querySelector<HTMLButtonElement>('.model-picker__trigger')
    expect(trigger).not.toBeNull()
    vi.spyOn(trigger!, 'getBoundingClientRect').mockReturnValue({
      x: 120,
      y: 180,
      top: 180,
      right: 300,
      bottom: 220,
      left: 120,
      width: 180,
      height: 40,
      toJSON: () => ({}),
    })

    await openPicker()

    const popover = document.querySelector<HTMLElement>('.model-picker__popover')
    expect(popover?.parentElement).toBe(document.body)
    expect(popover?.classList.contains('model-picker__popover--bottom')).toBe(true)
    expect(popover?.style.left).toBe('120px')
    expect(popover?.style.top).toBe('228px')
    expect(popover?.style.width).toBe('180px')
    expect(container.querySelector('.model-picker__popover')).toBeNull()
  })

  it('notifies the owner when the catalog picker opens', async () => {
    const onOpen = vi.fn()
    renderPicker({ onOpen })

    await openPicker()

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('can refresh an initially empty catalog when opened', async () => {
    const onOpen = vi.fn()
    renderPicker({ models: [], selection: null, onOpen })

    const trigger = container.querySelector<HTMLButtonElement>('.model-picker__trigger')
    expect(trigger?.disabled).toBe(false)
    await openPicker()

    expect(onOpen).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="status"]')?.textContent).toBe('No matching models')
  })

  it('searches, navigates, and selects from the keyboard', async () => {
    const onSelectionChange = vi.fn()
    renderPicker({ onSelectionChange })
    await openPicker()

    const search = document.querySelector<HTMLInputElement>('[role="combobox"]')
    expect(document.activeElement).toBe(search)

    act(() => document.querySelector<HTMLButtonElement>('.model-picker__group-header')?.click())

    act(() => {
      search?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    act(() => {
      search?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(onSelectionChange).toHaveBeenCalledWith(models[1])
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it('offers provider management and disables selection while busy', async () => {
    const onManageProviders = vi.fn()
    renderPicker({ onManageProviders, manageProvidersLabel: 'Manage providers' })
    await openPicker()

    act(() => {
      document.querySelector<HTMLButtonElement>('.model-picker__manage')?.click()
    })
    expect(onManageProviders).toHaveBeenCalledOnce()

    renderPicker({ busy: true, onManageProviders })
    const trigger = container.querySelector<HTMLButtonElement>('.model-picker__trigger')
    expect(trigger?.disabled).toBe(true)
    expect(trigger?.title).toBe('Model unavailable while generating')
  })

  it('keeps provider management reachable when the catalog is empty', async () => {
    const onManageProviders = vi.fn()
    renderPicker({ models: [], selection: null, onManageProviders })

    const trigger = container.querySelector<HTMLButtonElement>('.model-picker__trigger')
    expect(trigger?.disabled).toBe(false)
    await openPicker()

    expect(document.querySelector('[role="status"]')?.textContent).toBe('No matching models')
    act(() => document.querySelector<HTMLButtonElement>('.model-picker__manage')?.click())
    expect(onManageProviders).toHaveBeenCalledOnce()
  })
})
