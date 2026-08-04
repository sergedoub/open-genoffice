import { aiStrings } from './strings-ai'
import { appStrings } from './strings-app'
import { editorStrings } from './strings-editor'
import { ribbonStrings } from './strings-ribbon'

export const strings = {
  zh: { ...appStrings.zh, ...ribbonStrings.zh, ...editorStrings.zh, ...aiStrings.zh },
  en: { ...appStrings.en, ...ribbonStrings.en, ...editorStrings.en, ...aiStrings.en },
  ja: { ...appStrings.ja, ...ribbonStrings.ja, ...editorStrings.ja, ...aiStrings.ja },
  ko: { ...appStrings.ko, ...ribbonStrings.ko, ...editorStrings.ko, ...aiStrings.ko },
  fr: { ...appStrings.fr, ...ribbonStrings.fr, ...editorStrings.fr, ...aiStrings.fr },
  de: { ...appStrings.de, ...ribbonStrings.de, ...editorStrings.de, ...aiStrings.de },
  es: { ...appStrings.es, ...ribbonStrings.es, ...editorStrings.es, ...aiStrings.es },
  th: { ...appStrings.th, ...ribbonStrings.th, ...editorStrings.th, ...aiStrings.th },
  id: { ...appStrings.id, ...ribbonStrings.id, ...editorStrings.id, ...aiStrings.id },
  ru: { ...appStrings.ru, ...ribbonStrings.ru, ...editorStrings.ru, ...aiStrings.ru },
  ar: { ...appStrings.ar, ...ribbonStrings.ar, ...editorStrings.ar, ...aiStrings.ar },
  pt: { ...appStrings.pt, ...ribbonStrings.pt, ...editorStrings.pt, ...aiStrings.pt },
  it: { ...appStrings.it, ...ribbonStrings.it, ...editorStrings.it, ...aiStrings.it },
  pl: { ...appStrings.pl, ...ribbonStrings.pl, ...editorStrings.pl, ...aiStrings.pl },
  nl: { ...appStrings.nl, ...ribbonStrings.nl, ...editorStrings.nl, ...aiStrings.nl },
  ms: { ...appStrings.ms, ...ribbonStrings.ms, ...editorStrings.ms, ...aiStrings.ms },
  he: { ...appStrings.he, ...ribbonStrings.he, ...editorStrings.he, ...aiStrings.he },
  hi: { ...appStrings.hi, ...ribbonStrings.hi, ...editorStrings.hi, ...aiStrings.hi },
  'zh-TW': {
    ...appStrings['zh-TW'],
    ...ribbonStrings['zh-TW'],
    ...editorStrings['zh-TW'],
    ...aiStrings['zh-TW'],
  },
}
