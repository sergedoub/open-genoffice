import { describe, it, expect } from 'vitest'
import {
  parseGskOutput,
  parseGskWebSearch,
  parseGskImageSearch,
  parseGskGeneratedImage,
  extractGskText,
  parseToolCliNdjson,
} from '../src/gsk'

describe('parseGskOutput', () => {
  it('parses clean JSON', () => {
    expect(parseGskOutput('{"status":"ok"}')).toEqual({ status: 'ok' })
  })

  it('skips [INFO] noise lines before JSON', () => {
    const out = '[INFO] Calling /tools...\n[INFO] cache hit\n{"status":"ok","data":[1,2]}'
    expect(parseGskOutput(out)).toEqual({ status: 'ok', data: [1, 2] })
  })

  it('parses multi-line JSON after noise', () => {
    const out = '[INFO] x\n{\n "a": 1\n}'
    expect(parseGskOutput(out)).toEqual({ a: 1 })
  })

  it('throws when no JSON present', () => {
    expect(() => parseGskOutput('[INFO] nothing here')).toThrow()
  })
})

describe('parseGskWebSearch', () => {
  it('maps organic_results and respects maxResults', () => {
    const raw = {
      status: 'ok',
      data: {
        organic_results: [
          { title: 'A', link: 'https://a.com', snippet: 'sa' },
          { title: 'B', link: 'https://b.com', snippet: 'sb' },
          { title: 'C', link: 'https://c.com', snippet: 'sc' },
        ],
      },
    }
    const r = parseGskWebSearch(raw, 2)
    expect(r.results).toEqual([
      { title: 'A', url: 'https://a.com', snippet: 'sa' },
      { title: 'B', url: 'https://b.com', snippet: 'sb' },
    ])
    expect(r.answer).toBeUndefined()
  })

  it('tolerates missing data', () => {
    expect(parseGskWebSearch({ status: 'ok' }, 5).results).toEqual([])
  })
})

describe('parseGskImageSearch', () => {
  it('maps image entries with numeric size coercion', () => {
    const raw = {
      status: 'ok',
      data: [
        {
          image_url: 'https://sspark.genspark.ai/img1',
          title: 'T1',
          source: 'Site',
          link: 'https://site.com/page',
          width: '1000',
          height: '688',
        },
      ],
    }
    const images = parseGskImageSearch(raw, 8)
    expect(images).toEqual([
      {
        title: 'T1',
        imageUrl: 'https://sspark.genspark.ai/img1',
        sourceUrl: 'https://site.com/page',
        source: 'Site',
        width: 1000,
        height: 688,
      },
    ])
  })

  it('filters copyright hosts and entries without url', () => {
    const raw = {
      data: [
        { image_url: 'https://media.gettyimages.com/x.jpg', title: 'g' },
        { title: 'no-url' },
        { image_url: 'https://ok.com/a.jpg', title: 'ok' },
      ],
    }
    const images = parseGskImageSearch(raw, 8)
    expect(images.map((i) => i.title)).toEqual(['ok'])
  })
})

describe('parseGskGeneratedImage', () => {
  it('prefers no-watermark url', () => {
    const raw = {
      data: {
        generated_images: [
          {
            image_urls: ['https://cdn/wm.png'],
            image_urls_nowatermark: ['https://cdn/clean.png'],
            task_id: 't1',
          },
        ],
      },
    }
    expect(parseGskGeneratedImage(raw)).toEqual({ url: 'https://cdn/clean.png', taskId: 't1' })
  })

  it('falls back to image_urls, throws on empty', () => {
    expect(parseGskGeneratedImage({ data: { generated_images: [{ image_urls: ['https://cdn/a.png'] }] } }).url).toBe(
      'https://cdn/a.png',
    )
    expect(() => parseGskGeneratedImage({ data: { generated_images: [] } })).toThrow()
  })
})

describe('extractGskText', () => {
  it('returns string data directly', () => {
    expect(extractGskText({ data: 'hello' })).toBe('hello')
  })

  it('picks known text fields', () => {
    expect(extractGskText({ data: { analysis: 'deep' } })).toBe('deep')
    expect(extractGskText({ data: { transcript: 'words' } })).toBe('words')
  })

  it('stringifies unknown shapes', () => {
    expect(extractGskText({ data: { foo: 1 } })).toBe('{"foo":1}')
  })
})

describe('parseToolCliNdjson', () => {
  it('skips heartbeat lines and returns the final status line', () => {
    const text =
      '{"version":1,"debug":true,"message":"Still processing... (5.0s)","heartbeat":1}\n' +
      '{"version":1,"debug":true,"message":"Still processing... (10.0s)","heartbeat":2}\n' +
      '{"version":1,"status":"ok","message":"success","data":{"pptx_url":"https://x/y","model":"claude-opus-4-7"}}'
    const r = parseToolCliNdjson(text)
    expect(r.status).toBe('ok')
    expect((r.data as { model: string }).model).toBe('claude-opus-4-7')
  })

  it('returns error result lines as-is', () => {
    const r = parseToolCliNdjson('{"version":1,"status":"error","message":"deck_context must be an object","data":null}')
    expect(r.status).toBe('error')
    expect(r.message).toMatch(/deck_context/)
  })

  it('throws when no result line exists', () => {
    expect(() => parseToolCliNdjson('{"heartbeat":1}\nnot json')).toThrow(/No result line/)
  })
})
