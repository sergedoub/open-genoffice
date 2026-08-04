import { describe, expect, it } from 'vitest'
import type { PublicAiProvider } from '../../docs/src/shared/ipc'
import { shouldShowGensparkLogin } from '../src/renderer/src/settings/provider-card'

const genspark: PublicAiProvider = {
  id: 'genspark',
  label: 'Genspark',
  status: 'unavailable',
  hasApiKey: false,
}

describe('Genspark provider card', () => {
  it('offers login instead of the unavailable status when signed out', () => {
    expect(shouldShowGensparkLogin(genspark, true)).toBe(true)
  })

  it('keeps the status badge when login cannot be started', () => {
    expect(shouldShowGensparkLogin(genspark, false)).toBe(false)
  })

  it('does not replace status badges for other provider states', () => {
    expect(shouldShowGensparkLogin({ ...genspark, status: 'connected' }, true)).toBe(false)
    expect(
      shouldShowGensparkLogin({ ...genspark, id: 'openrouter', label: 'OpenRouter' }, true),
    ).toBe(false)
  })
})
