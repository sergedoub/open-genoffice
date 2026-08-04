import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/core'
import { useI18n } from '../i18n/locale'
import { searchPluginKey } from '../editor/extensions'

interface Range {
  from: number
  to: number
}

interface FindOptions {
  matchCase: boolean
  wholeWord: boolean
}

const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch)

/** collect matches inside editable textblocks (protected blocks excluded) */
function findMatches(editor: Editor, query: string, opts: FindOptions): Range[] {
  const found: Range[] = []
  if (!query) return found
  const needle = opts.matchCase ? query : query.toLowerCase()
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    // flatten the block's inline content so matches spanning marks are found
    let text = ''
    const posAt: number[] = []
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        for (let k = 0; k < child.text.length; k++) posAt.push(pos + 1 + offset + k)
        text += child.text
      } else {
        posAt.push(pos + 1 + offset)
        text += '\u0000' // leaf placeholder (hard break) never matches
      }
    })
    const haystack = opts.matchCase ? text : text.toLowerCase()
    let i = 0
    while ((i = haystack.indexOf(needle, i)) !== -1) {
      const isWhole =
        !opts.wholeWord || (!isWordChar(text[i - 1]) && !isWordChar(text[i + query.length]))
      if (isWhole) {
        found.push({ from: posAt[i], to: posAt[i + query.length - 1] + 1 })
        i += query.length
      } else {
        i += 1
      }
    }
    return false
  })
  return found
}

interface FindPanelProps {
  editor: Editor
  onClose: () => void
}

export function FindPanel({ editor, onClose }: FindPanelProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [matches, setMatches] = useState<Range[]>([])
  const [index, setIndex] = useState(0)
  const [matchCase, setMatchCase] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const highlight = useCallback(
    (ranges: Range[], activeIndex: number) => {
      editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, { ranges, activeIndex }))
    },
    [editor],
  )

  const scrollTo = useCallback(
    (range: Range) => {
      const { node } = editor.view.domAtPos(range.from)
      const el = node instanceof HTMLElement ? node : node.parentElement
      el?.scrollIntoView({ block: 'center' })
    },
    [editor],
  )

  const refresh = useCallback(
    (q: string, keepIndex = 0, opts?: Partial<FindOptions>) => {
      const ranges = findMatches(editor, q, { matchCase, wholeWord, ...opts })
      const active = ranges.length === 0 ? 0 : Math.min(keepIndex, ranges.length - 1)
      setMatches(ranges)
      setIndex(active)
      highlight(ranges, active)
      if (ranges.length > 0) scrollTo(ranges[active])
      return ranges
    },
    [editor, highlight, scrollTo, matchCase, wholeWord],
  )

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // stay in sync while the document changes underneath (typing, AI edits)
  useEffect(() => {
    const onUpdate = () => {
      if (!query) return
      const ranges = findMatches(editor, query, { matchCase, wholeWord })
      setMatches(ranges)
      setIndex((i) => Math.min(i, Math.max(ranges.length - 1, 0)))
    }
    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor, query, matchCase, wholeWord])

  const close = useCallback(() => {
    highlight([], 0)
    onClose()
  }, [highlight, onClose])

  const step = useCallback(
    (dir: 1 | -1) => {
      if (matches.length === 0) return
      const next = (index + dir + matches.length) % matches.length
      setIndex(next)
      highlight(matches, next)
      scrollTo(matches[next])
    },
    [matches, index, highlight, scrollTo],
  )

  const replaceOne = useCallback(() => {
    const m = matches[index]
    if (!m) return
    editor.commands.command(({ tr }) => {
      tr.insertText(replacement, m.from, m.to)
      return true
    })
    refresh(query, index)
  }, [editor, matches, index, replacement, query, refresh])

  const replaceAll = useCallback(() => {
    if (matches.length === 0) return
    editor.commands.command(({ tr }) => {
      for (const m of [...matches].reverse()) tr.insertText(replacement, m.from, m.to)
      return true
    })
    refresh(query)
  }, [editor, matches, replacement, query, refresh])

  return (
    <div className="find-panel">
      <div className="find-row">
        <input
          ref={inputRef}
          className="find-input"
          placeholder={t('appFindPlaceholder')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            refresh(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') step(e.shiftKey ? -1 : 1)
            if (e.key === 'Escape') close()
          }}
        />
        <button
          className={`find-opt ${matchCase ? 'on' : ''}`}
          title={t('appMatchCase')}
          onClick={() => {
            setMatchCase(!matchCase)
            refresh(query, index, { matchCase: !matchCase })
          }}
        >
          Aa
        </button>
        <button
          className={`find-opt ${wholeWord ? 'on' : ''}`}
          title={t('appWholeWord')}
          onClick={() => {
            setWholeWord(!wholeWord)
            refresh(query, index, { wholeWord: !wholeWord })
          }}
        >
          W
        </button>
        <span className="find-count">
          {query ? (matches.length === 0 ? t('appNoResults') : `${index + 1}/${matches.length}`) : ''}
        </span>
        <button className="find-btn" title={t('appPrevMatch')} onClick={() => step(-1)} disabled={matches.length === 0}>
          ‹
        </button>
        <button className="find-btn" title={t('appNextMatch')} onClick={() => step(1)} disabled={matches.length === 0}>
          ›
        </button>
        <button className="find-btn find-close" title={t('appCloseEsc')} onClick={close}>
          ✕
        </button>
      </div>
      <div className="find-row">
        <input
          className="find-input"
          placeholder={t('appReplacePlaceholder')}
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') replaceOne()
            if (e.key === 'Escape') close()
          }}
        />
        <button className="find-action" onClick={replaceOne} disabled={matches.length === 0}>
          {t('appReplace')}
        </button>
        <button className="find-action" onClick={replaceAll} disabled={matches.length === 0}>
          {t('appReplaceAll')}
        </button>
      </div>
    </div>
  )
}
