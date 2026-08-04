import { describe, expect, it } from 'vitest'
import {
  MODEL_REFRESH_INTERVAL_MS,
  modelListNeedsRefresh,
} from '../src/renderer/src/settings/ai-settings-refresh'

const freshResult = {
  models: [],
  catalogs: [
    { providerId: 'genspark' as const, fetchedAt: '2026-08-04T00:00:00.000Z', stale: false },
  ],
}

describe('model list refresh policy', () => {
  it('refreshes missing and stale results', () => {
    expect(modelListNeedsRefresh(null, Date.now())).toBe(true)
    expect(
      modelListNeedsRefresh(
        { ...freshResult, catalogs: [{ ...freshResult.catalogs[0], stale: true }] },
        Date.now(),
      ),
    ).toBe(true)
    expect(
      modelListNeedsRefresh(
        { ...freshResult, catalogs: [{ ...freshResult.catalogs[0], error: 'offline' }] },
        Date.now(),
      ),
    ).toBe(true)
  })

  it('waits until the five-minute interval has elapsed for fresh results', () => {
    const now = 1_000_000
    expect(modelListNeedsRefresh(freshResult, now - MODEL_REFRESH_INTERVAL_MS + 1, now)).toBe(false)
    expect(modelListNeedsRefresh(freshResult, now - MODEL_REFRESH_INTERVAL_MS, now)).toBe(true)
  })
})
