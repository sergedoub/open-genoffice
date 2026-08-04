import type { ListAiModelsResult } from '../../../../../docs/src/shared/ipc'

export const MODEL_REFRESH_INTERVAL_MS = 5 * 60 * 1000

export function modelListNeedsRefresh(
  result: ListAiModelsResult | null,
  lastRefreshedAt: number,
  now = Date.now(),
): boolean {
  if (!result) return true
  if (result.catalogs.some((catalog) => catalog.stale || catalog.error)) return true
  if (result.catalogs.length === 0) return false
  return !Number.isFinite(lastRefreshedAt) || now - lastRefreshedAt >= MODEL_REFRESH_INTERVAL_MS
}
