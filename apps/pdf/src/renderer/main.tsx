import { createRoot } from 'react-dom/client'
import type { Lang } from '@genoffice/i18n'
import App from './App'
import { LocaleProvider } from './i18n/locale'
import './styles.css'

void (async () => {
  const lang: Lang = await window.pdfApi.getLanguage().catch(() => 'zh' as const)
  document.documentElement.lang = lang
  createRoot(document.getElementById('root')!).render(
    <LocaleProvider initial={lang}>
      <App />
    </LocaleProvider>,
  )
})()
