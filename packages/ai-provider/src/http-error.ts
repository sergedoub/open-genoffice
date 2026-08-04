function stringAt(value: unknown, path: string[]): string | undefined {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' && current.trim() ? current.trim() : undefined
}

function jsonErrorMessage(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body)
    return (
      stringAt(parsed, ['error', 'metadata', 'raw']) ??
      stringAt(parsed, ['error', 'message']) ??
      stringAt(parsed, ['message']) ??
      stringAt(parsed, ['error'])
    )
  } catch {
    return undefined
  }
}

/**
 * Readable detail for a non-OK provider response. Provider JSON is reduced to
 * its useful message and known rate-limit failures are normalized so internal
 * routing metadata and raw response objects never spill into the chat rail.
 */
export function httpBodyDetail(body: string, status?: number): string {
  const head = body.trimStart().slice(0, 30).toLowerCase()
  const isHtml = ['<!doctype', '<html', '<head', '<body'].some((tag) => head.startsWith(tag))
  if (isHtml) {
    return 'the service returned a web page instead of an API response (likely a temporary network or gateway block) — check your connection and retry'
  }

  const message = jsonErrorMessage(body) ?? body.trim()
  if (status === 429 || /rate[ -]?limit|too many requests/i.test(message)) {
    return 'This model is temporarily rate-limited by its upstream provider. Try again shortly or choose another model.'
  }
  return message.slice(0, 500)
}
