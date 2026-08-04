import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { StyleInfo } from '@genoffice/docx-engine'
import { useI18n } from '../i18n/locale'
import { cssFontFamily } from '../line-metrics'

/**
 * Styles popup (Word's styles dialog): lists the document's paragraph/character
 * styles, click to apply; "Update" rewrites the style definition from the current
 * selection's formatting (styles.xml upsert), and the bottom row creates a new
 * style from the selection. Style edits/creations go through
 * SaveOptions.styleUpserts and the canvas CSS refreshes immediately.
 */
export function StylesPanel({
  styles,
  activeParaStyleId,
  onApply,
  onUpdateFromSelection,
  onCreateFromSelection,
  onClose,
}: {
  styles: Map<string, StyleInfo>
  activeParaStyleId: string | null
  /** Apply a style: type decides paragraph (styleId attr) vs character (docTextStyle mark) */
  onApply: (styleId: string, type: 'paragraph' | 'character') => void
  onUpdateFromSelection: (styleId: string, type: 'paragraph' | 'character', name: string) => void
  onCreateFromSelection: (name: string, type: 'paragraph' | 'character') => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<'paragraph' | 'character'>('paragraph')

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const previewCss = (info: StyleInfo): CSSProperties => {
    const d = info.display
    const css: CSSProperties = {}
    if (d?.bold) css.fontWeight = 600
    if (d?.italic) css.fontStyle = 'italic'
    if (d?.underline) css.textDecoration = 'underline'
    if (d?.color) css.color = `#${d.color}`
    if (d?.sizeHalfPoints) css.fontSize = `${Math.min(d.sizeHalfPoints / 2, 18)}pt`
    if (d?.font) css.fontFamily = cssFontFamily(d.font)
    return css
  }

  const groups: Array<{ label: string; type: 'paragraph' | 'character'; items: StyleInfo[] }> = [
    { label: t('appParagraphStyles'), type: 'paragraph', items: [] },
    { label: t('appCharacterStyles'), type: 'character', items: [] },
  ]
  for (const info of styles.values()) {
    if (info.type === 'paragraph') groups[0].items.push(info)
    else if (info.type === 'character' && info.styleId !== 'FollowedHyperlink') {
      groups[1].items.push(info)
    }
  }

  const create = () => {
    const name = newName.trim()
    if (!name) return
    onCreateFromSelection(name, newType)
    setNewName('')
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="styles-modal" onClick={(e) => e.stopPropagation()}>
        <div className="styles-panel-head">
          <span>{t('appStylesTitle')}</span>
          <button className="styles-panel-close" onClick={onClose} title={t('appClose')}>
            ×
          </button>
        </div>
        <div className="styles-panel-body">
          {groups.map(
            (group) =>
              group.items.length > 0 && (
                <div key={group.type}>
                  <div className="styles-panel-group">{group.label}</div>
                  {group.items.map((info) => (
                    <div
                      key={info.styleId}
                      className={`styles-panel-row ${
                        group.type === 'paragraph' && info.styleId === activeParaStyleId
                          ? 'active'
                          : ''
                      }`}
                    >
                      <button
                        className="styles-panel-name"
                        style={previewCss(info)}
                        title={t('appApplyStyle', { name: info.name })}
                        onClick={() => onApply(info.styleId, group.type)}
                      >
                        {info.name}
                      </button>
                      <button
                        className="styles-panel-update"
                        title={t('appUpdateStyleTip')}
                        onClick={() => onUpdateFromSelection(info.styleId, group.type, info.name)}
                      >
                        {t('appUpdate')}
                      </button>
                    </div>
                  ))}
                </div>
              ),
          )}
        </div>
        <div className="styles-panel-new">
          <div className="styles-panel-group">{t('appNewStyleFromSelection')}</div>
          <div className="styles-panel-new-row">
            <input
              value={newName}
              placeholder={t('appStyleNamePlaceholder')}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create()
              }}
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as 'paragraph' | 'character')}
            >
              <option value="paragraph">{t('appParagraph')}</option>
              <option value="character">{t('appCharacter')}</option>
            </select>
            <button disabled={!newName.trim()} onClick={create}>
              {t('appNew')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
