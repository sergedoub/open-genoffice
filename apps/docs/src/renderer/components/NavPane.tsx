import type { Editor } from '@tiptap/core'
import { t } from '../i18n/locale'

/** Word's navigation pane: heading outline with click-to-jump. */
export function NavPane({ editor }: { editor: Editor }) {
  const headings: Array<{ text: string; level: number; pos: number }> = []
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === 'docHeading' && node.textContent.trim()) {
      headings.push({ text: node.textContent, level: Number(node.attrs.level) || 1, pos: offset })
    }
  })
  return (
    <aside className="nav-pane">
      <div className="nav-pane-title">{t('appNavTitle')}</div>
      <div className="nav-pane-list">
        {headings.map((h, i) => (
          <button
            key={`${h.pos}-${i}`}
            className={`nav-item nav-l${Math.min(h.level, 4)}`}
            title={h.text}
            onClick={() => {
              const dom = editor.view.nodeDOM(h.pos) as HTMLElement | null
              dom?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            {h.text}
          </button>
        ))}
        {headings.length === 0 && <div className="nav-empty">{t('appNavNoHeadings')}</div>}
      </div>
    </aside>
  )
}
