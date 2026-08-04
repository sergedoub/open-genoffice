import { describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { StageAiToggle } from '../src/renderer/components/StageAiToggle'

describe('StageAiToggle', () => {
  it('renders the AI rail as an icon-only accessible control', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onClick = vi.fn()

    act(() => {
      root.render(
        createElement(StageAiToggle, {
          active: true,
          icon: createElement('svg', { 'aria-hidden': true }),
          onClick,
          title: 'Open AI assistant',
        }),
      )
    })

    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    expect(button?.textContent).toBe('')
    expect(button?.getAttribute('aria-label')).toBe('Open AI assistant')
    expect(button?.className).toContain('active')

    act(() => button?.click())
    expect(onClick).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    container.remove()
  })
})
