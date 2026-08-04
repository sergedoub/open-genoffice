import { describe, expect, it } from 'vitest'
import { httpBodyDetail } from '../src/http-error'

describe('httpBodyDetail', () => {
  it('turns an OpenRouter upstream 429 into a concise message', () => {
    const body = JSON.stringify({
      error: {
        message: 'Provider returned error',
        code: 429,
        metadata: {
          raw: 'google/gemma-4-31b-it:free is temporarily rate-limited upstream. Please retry shortly, or add your own key.',
          provider_name: 'Google AI Studio',
          limit_source: 'upstream_provider_shared_pool',
        },
      },
    })

    expect(httpBodyDetail(body, 429)).toBe(
      'This model is temporarily rate-limited by its upstream provider. Try again shortly or choose another model.',
    )
  })

  it('extracts a useful API message without exposing the response object', () => {
    expect(httpBodyDetail('{"error":{"message":"Invalid API key","code":401}}', 401)).toBe(
      'Invalid API key',
    )
  })

  it('keeps a concise plain-text provider error', () => {
    expect(httpBodyDetail('bad key', 401)).toBe('bad key')
  })
})
