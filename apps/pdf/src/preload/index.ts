import { contextBridge, ipcRenderer } from 'electron'
import type { Lang } from '@genoffice/i18n'
import type { AiStreamChunk } from '@genoffice/ai-provider'
import {
  AI_CHANNELS,
  PDF_CHANNELS,
  PROJECT_CHANNELS,
  toRouteOnlyAiStreamRequest,
} from '../shared/ipc'
import type { PdfApi } from '../shared/ipc'

const api: PdfApi = {
  consumePending: () => ipcRenderer.invoke(PDF_CHANNELS.consumePending),
  readFile: (path) => ipcRenderer.invoke(PDF_CHANNELS.readFile, path),
  save: (request) => ipcRenderer.invoke(PDF_CHANNELS.save, request),
  extractPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.extractPages, request),
  insertPdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.insertPdf, request),
  exportImages: (request) => ipcRenderer.invoke(PDF_CHANNELS.exportImages, request),
  setDirty: (dirty) => ipcRenderer.send(PDF_CHANNELS.dirtyChanged, dirty),
  onCloseSaveRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(PDF_CHANNELS.closeSaveRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.closeSaveRequest, listener)
  },
  sendCloseSaveResult: (ok) => ipcRenderer.send(PDF_CHANNELS.closeSaveResult, ok),
  getLanguage: () => ipcRenderer.invoke(PDF_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, lang: Lang) => handler(lang)
    ipcRenderer.on(PDF_CHANNELS.languageChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.languageChanged, listener)
  },
  getAiPublicSettings: () => ipcRenderer.invoke(AI_CHANNELS.getPublicSettings),
  listAiModels: (args) => ipcRenderer.invoke(AI_CHANNELS.listModels, args),
  getAiConversationRoute: (identity) =>
    ipcRenderer.invoke(AI_CHANNELS.getConversationRoute, identity),
  setAiConversationRoute: (identity, route) =>
    ipcRenderer.invoke(AI_CHANNELS.setConversationRoute, identity, route),
  aiStream: (request) =>
    ipcRenderer.invoke(AI_CHANNELS.stream, toRouteOnlyAiStreamRequest(request)),
  aiStreamCancel: (requestId) => ipcRenderer.invoke(AI_CHANNELS.streamCancel, requestId),
  onAiStream: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, chunk: AiStreamChunk) => handler(chunk)
    ipcRenderer.on(AI_CHANNELS.streamChunk, listener)
    return () => ipcRenderer.removeListener(AI_CHANNELS.streamChunk, listener)
  },
  resolveProjectChat: (args) => ipcRenderer.invoke(PROJECT_CHANNELS.resolveChat, args),
  appendProjectChat: (args) => ipcRenderer.invoke(PROJECT_CHANNELS.appendChat, args),
  loadProjectChat: (args) => ipcRenderer.invoke(PROJECT_CHANNELS.loadChat, args),
  rebindProjectChat: (args) => ipcRenderer.invoke(PROJECT_CHANNELS.rebindChat, args),
}

contextBridge.exposeInMainWorld('pdfApi', api)
