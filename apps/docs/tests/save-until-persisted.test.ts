import { describe, expect, it, vi } from 'vitest'
import { saveUntilPersisted } from '../src/renderer/save-until-persisted'

/** deps whose save() reports "incomplete" for the first `incompletePasses` calls */
const depsWith = (incompletePasses: number, hasPath = true) => {
  let calls = 0
  const save = vi.fn(async () => {
    calls++
    return true
  })
  return {
    save,
    wasIncomplete: () => calls <= incompletePasses,
    hasPath: () => hasPath,
  }
}

describe('saveUntilPersisted', () => {
  it('reports success after a single fully persisted save', async () => {
    const deps = depsWith(0)
    await expect(saveUntilPersisted(deps)).resolves.toBe(true)
    expect(deps.save).toHaveBeenCalledTimes(1)
  })

  it('saves again when the editor changed mid-save, then reports success', async () => {
    const deps = depsWith(1)
    await expect(saveUntilPersisted(deps)).resolves.toBe(true)
    expect(deps.save).toHaveBeenCalledTimes(2)
  })

  // the regression: an incomplete save must never be reported as complete, or the
  // close guard closes the window over edits that never reached disk
  it('reports failure when the document never catches up', async () => {
    const deps = depsWith(Number.POSITIVE_INFINITY)
    await expect(saveUntilPersisted(deps)).resolves.toBe(false)
    expect(deps.save).toHaveBeenCalledTimes(3)
  })

  it('honours a custom pass budget', async () => {
    const deps = depsWith(Number.POSITIVE_INFINITY)
    await expect(saveUntilPersisted({ ...deps, maxPasses: 5 })).resolves.toBe(false)
    expect(deps.save).toHaveBeenCalledTimes(5)
  })

  it('propagates a failed save without retrying', async () => {
    const save = vi.fn(async () => false)
    const deps = { save, wasIncomplete: () => true, hasPath: () => true }
    await expect(saveUntilPersisted(deps)).resolves.toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not retry a pathless document (Save As would prompt again)', async () => {
    const deps = depsWith(Number.POSITIVE_INFINITY, false)
    await expect(saveUntilPersisted(deps)).resolves.toBe(true)
    expect(deps.save).toHaveBeenCalledTimes(1)
  })
})
