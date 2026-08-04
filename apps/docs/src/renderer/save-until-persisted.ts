/// Convergence wrapper for the close guard. A save that raced with typing writes
/// a snapshot that is already one step behind, and reporting that as success lets
/// the window close over unpersisted edits — so keep saving until the file caught
/// up with the editor.

export interface SaveUntilPersistedDeps {
  /** Runs one full save; false means the save itself failed. */
  save: () => Promise<boolean>
  /** True when the last save wrote successfully but the editor changed mid-flight. */
  wasIncomplete: () => boolean
  /**
   * False for a document with no path yet: that save goes through the Save As
   * dialog, so retrying would prompt again — and a modal dialog means the user
   * was not typing anyway.
   */
  hasPath: () => boolean
  /** Passes before giving up (a user typing without pause never converges). */
  maxPasses?: number
}

/**
 * True only when the document is fully on disk. False means the caller must not
 * treat the save as complete — for the close guard, keep the window open.
 */
export async function saveUntilPersisted(deps: SaveUntilPersistedDeps): Promise<boolean> {
  const { save, wasIncomplete, hasPath, maxPasses = 3 } = deps
  for (let pass = 0; pass < maxPasses; pass++) {
    if (!(await save())) return false
    if (!wasIncomplete()) return true
    if (!hasPath()) return true
  }
  return false
}
