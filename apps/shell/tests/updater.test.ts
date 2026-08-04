import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateUiState } from '../src/shared/update-api'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/**
 * Main-process auto-updater flow (src/main/updater.ts): manual-download policy
 * driven by the strong-guidance update window — the renderer's Download /
 * Install / Later actions come back through update-window.ts callbacks.
 */

const appState = { isPackaged: true }

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged
    },
    getVersion: () => '0.1.0',
  },
}))

type Listener = (...args: unknown[]) => unknown

const updaterState = {
  listeners: new Map<string, Listener>(),
  autoDownload: true,
  autoInstallOnAppQuit: false,
  disableDifferentialDownload: false,
}
const checkForUpdates = vi.fn(() => Promise.resolve(null))
const downloadUpdate = vi.fn<() => Promise<unknown>>(() => Promise.resolve([]))
const quitAndInstall = vi.fn()

vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: (event: string, listener: Listener) => {
      updaterState.listeners.set(event, listener)
    },
    checkForUpdates: () => checkForUpdates(),
    downloadUpdate: () => downloadUpdate(),
    quitAndInstall: (...args: unknown[]) => quitAndInstall(...(args as [boolean, boolean])),
    set autoDownload(v: boolean) {
      updaterState.autoDownload = v
    },
    set autoInstallOnAppQuit(v: boolean) {
      updaterState.autoInstallOnAppQuit = v
    },
    set disableDifferentialDownload(v: boolean) {
      updaterState.disableDifferentialDownload = v
    },
  },
}))

interface UpdateActions {
  onDownload: () => void
  onInstall: () => void
  onLater: () => void
}

const showUpdateWindow =
  vi.fn<(parent: unknown, state: UpdateUiState, actions: UpdateActions) => void>()
const pushUpdateState = vi.fn<(patch: Partial<UpdateUiState>) => void>()
const closeUpdateWindow = vi.fn()

vi.mock('../src/main/update-window', () => ({
  showUpdateWindow: (...args: [unknown, UpdateUiState, UpdateActions]) => showUpdateWindow(...args),
  pushUpdateState: (patch: Partial<UpdateUiState>) => pushUpdateState(patch),
  closeUpdateWindow: () => closeUpdateWindow(),
}))

const FIRST_CHECK_DELAY_MS = 15_000
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let platformSpy: { restore: () => void } | null = null
let resourcesPathRestore: (() => void) | null = null
let resourcesDir = ''

function setPlatform(platform: string): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { value: platform })
  platformSpy = {
    restore: () => Object.defineProperty(process, 'platform', original),
  }
}

function setResourcesPath(path: string): void {
  const original = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: path })
  resourcesPathRestore = () => {
    if (original) Object.defineProperty(process, 'resourcesPath', original)
    else delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  }
}

function writeUpdateConfig(url: string): void {
  writeFileSync(join(resourcesDir, 'app-update.yml'), `provider: generic\nurl: ${url}\n`)
}

async function loadUpdater() {
  return import('../src/main/updater')
}

async function flushAsync(): Promise<void> {
  // drain promise chains queued by download callbacks
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

function lastShownState(): UpdateUiState {
  return showUpdateWindow.mock.calls.at(-1)![1]
}

function lastShownActions(): UpdateActions {
  return showUpdateWindow.mock.calls.at(-1)![2]
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  appState.isPackaged = true
  delete process.env.GENOFFICE_FAKE_UPDATE
  delete process.env.GENOFFICE_UPDATE_URL
  delete process.env.OPEN_GENOFFICE_UPDATE_URL
  updaterState.listeners.clear()
  updaterState.autoDownload = true
  updaterState.autoInstallOnAppQuit = false
  updaterState.disableDifferentialDownload = false
  checkForUpdates.mockClear()
  downloadUpdate.mockReset()
  downloadUpdate.mockImplementation(() => Promise.resolve([]))
  quitAndInstall.mockClear()
  showUpdateWindow.mockClear()
  pushUpdateState.mockClear()
  closeUpdateWindow.mockClear()
  setPlatform('darwin')
  resourcesDir = mkdtempSync(join(tmpdir(), 'open-genoffice-updater-'))
  setResourcesPath(resourcesDir)
  writeUpdateConfig('https://updates.example.com/open-genoffice')
})

afterEach(() => {
  vi.useRealTimers()
  platformSpy?.restore()
  platformSpy = null
  resourcesPathRestore?.()
  resourcesPathRestore = null
  rmSync(resourcesDir, { force: true, recursive: true })
  resourcesDir = ''
  delete process.env.GENOFFICE_FAKE_UPDATE
  delete process.env.GENOFFICE_UPDATE_URL
  delete process.env.OPEN_GENOFFICE_UPDATE_URL
})

describe('initAutoUpdater', () => {
  it('does nothing in unpacked (dev) runs without the fake-update env', async () => {
    appState.isPackaged = false
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(updaterState.listeners.size).toBe(0)
    expect(checkForUpdates).not.toHaveBeenCalled()
    expect(showUpdateWindow).not.toHaveBeenCalled()
  })

  it('does nothing on unsupported platforms', async () => {
    platformSpy?.restore()
    setPlatform('linux')
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(updaterState.listeners.size).toBe(0)
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('does nothing in a packaged fork without an explicit update configuration', async () => {
    unlinkSync(join(resourcesDir, 'app-update.yml'))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(updaterState.listeners.size).toBe(0)
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('rejects a packaged Genspark update feed inherited from upstream', async () => {
    writeUpdateConfig('https://cdn1.genspark.ai./user-upload-image/client/genoffice')
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(updaterState.listeners.size).toBe(0)
    expect(checkForUpdates).not.toHaveBeenCalled()
  })

  it('configures manual full-package download and checks after the initial delay', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    expect(updaterState.autoDownload).toBe(false)
    expect(updaterState.autoInstallOnAppQuit).toBe(true)
    expect(updaterState.disableDifferentialDownload).toBe(true)
    expect(checkForUpdates).not.toHaveBeenCalled()
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('re-checks on the periodic interval', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RECHECK_INTERVAL_MS)
    expect(checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('is idempotent across repeated init calls', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('opens the update window with the available state when an update is found', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    updaterState.listeners.get('update-available')!({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    const state = lastShownState()
    expect(state.phase).toBe('available')
    expect(state.version).toBe('0.2.0')
    expect(state.currentVersion).toBe('0.1.0')
    expect(state.percent).toBe(0)
    // strings are localized main-side and pushed into the window state
    expect(state.strings.title.length).toBeGreaterThan(0)
    expect(state.strings.install.length).toBeGreaterThan(0)
  })

  it('starts the download and pushes progress when the user clicks download', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    updaterState.listeners.get('update-available')!({ version: '0.2.0' })
    lastShownActions().onDownload()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloading', percent: 0 })
    expect(downloadUpdate).toHaveBeenCalledTimes(1)

    updaterState.listeners.get('download-progress')!({ percent: 42 })
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloading', percent: 42 })

    updaterState.listeners.get('update-downloaded')!({ version: '0.2.0' })
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloaded', percent: 100 })
  })

  it('surfaces a failed download as the error phase', async () => {
    downloadUpdate.mockImplementation(() => Promise.reject(new Error('offline')))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    updaterState.listeners.get('update-available')!({ version: '0.2.0' })
    lastShownActions().onDownload()
    await flushAsync()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'error' })
  })

  it('closes the window and installs on restart when the user confirms', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    updaterState.listeners.get('update-available')!({ version: '0.2.0' })
    lastShownActions().onInstall()
    expect(closeUpdateWindow).toHaveBeenCalledTimes(1)
    // quitAndInstall is deferred so the window can finish closing first
    expect(quitAndInstall).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('does not re-prompt for a version the user dismissed this session', async () => {
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    const available = updaterState.listeners.get('update-available')!
    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    lastShownActions().onLater()
    expect(closeUpdateWindow).toHaveBeenCalledTimes(1)

    available({ version: '0.2.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)

    // a newer version prompts again
    available({ version: '0.3.0' })
    expect(showUpdateWindow).toHaveBeenCalledTimes(2)
  })

  it('swallows background check failures', async () => {
    checkForUpdates.mockImplementation(() => Promise.reject(new Error('offline')))
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(FIRST_CHECK_DELAY_MS)
    await flushAsync()
    expect(showUpdateWindow).not.toHaveBeenCalled()
  })
})

describe('Open GenOffice builder configuration', () => {
  const require = createRequire(import.meta.url)
  const configPath = fileURLToPath(new URL('../electron-builder.cjs', import.meta.url))
  const mainSourcePath = fileURLToPath(new URL('../src/main/index.ts', import.meta.url))

  function loadBuilderConfig(): Record<string, unknown> {
    delete require.cache[configPath]
    return require(configPath) as Record<string, unknown>
  }

  it('uses an isolated app identity, has no default file associations, and ignores the vendor env', () => {
    process.env.GENOFFICE_UPDATE_URL = 'https://cdn1.genspark.ai/user-upload-image/client/genoffice'
    const config = loadBuilderConfig()
    expect(config.appId).toBe('com.sergedoub.opengenoffice')
    expect(config.productName).toBe('Open GenOffice')
    expect(config.fileAssociations).toBeUndefined()
    expect(config.publish).toBeUndefined()
    expect(config.mac).toMatchObject({ identity: null, notarize: false })
    expect(config.mac).toMatchObject({
      artifactName: 'OpenGenOffice-${version}-${arch}.${ext}',
    })
    expect(config.win).toMatchObject({
      artifactName: 'OpenGenOfficeSetup-v${version}-${arch}.${ext}',
      extraResources: [
        {
          from: '../sheets/native/xlsx-engine/target/release/xlsx-sidecar.exe',
          to: 'native/xlsx-sidecar.exe',
        },
      ],
    })
    expect(config.dmg).toMatchObject({ sign: false })
    expect(config.afterSign).toBe('build/adhoc-sign.js')
  })

  it('does not import user data from other product identities', () => {
    const source = readFileSync(mainSourcePath, 'utf8')
    expect(source).not.toContain('cpSync(')
    expect(source).not.toContain('app.setName(')
  })

  it('emits publish metadata only for the explicit Open GenOffice update URL', () => {
    process.env.OPEN_GENOFFICE_UPDATE_URL = 'https://updates.example.com/open-genoffice/'
    const config = loadBuilderConfig()
    expect(config.publish).toEqual([
      {
        provider: 'generic',
        url: 'https://updates.example.com/open-genoffice',
        channel: 'latest',
      },
    ])
  })

  it('rejects a Genspark host even through the fork update variable', () => {
    process.env.OPEN_GENOFFICE_UPDATE_URL =
      'https://cdn1.genspark.ai./user-upload-image/client/genoffice'
    expect(() => loadBuilderConfig()).toThrow(/must not point to a Genspark update feed/)
  })
})

describe('initAutoUpdater (fake update preview)', () => {
  it('runs a simulated download to completion in unpacked runs', async () => {
    appState.isPackaged = false
    process.env.GENOFFICE_FAKE_UPDATE = '9.9.9'
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)

    // the fake flow never touches the real updater
    expect(updaterState.listeners.size).toBe(0)

    vi.advanceTimersByTime(1500)
    expect(showUpdateWindow).toHaveBeenCalledTimes(1)
    expect(lastShownState().version).toBe('9.9.9')

    lastShownActions().onDownload()
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloading', percent: 0 })
    vi.advanceTimersByTime(3000)
    expect(pushUpdateState).toHaveBeenCalledWith({ phase: 'downloaded', percent: 100 })
    expect(checkForUpdates).not.toHaveBeenCalled()
    expect(downloadUpdate).not.toHaveBeenCalled()
  })

  it('closes the window on later and install without touching electron-updater', async () => {
    appState.isPackaged = false
    process.env.GENOFFICE_FAKE_UPDATE = '9.9.9'
    const { initAutoUpdater } = await loadUpdater()
    initAutoUpdater(() => null)
    vi.advanceTimersByTime(1500)

    lastShownActions().onLater()
    expect(closeUpdateWindow).toHaveBeenCalledTimes(1)
    lastShownActions().onInstall()
    expect(closeUpdateWindow).toHaveBeenCalledTimes(2)
    expect(quitAndInstall).not.toHaveBeenCalled()
  })
})
