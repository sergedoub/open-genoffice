import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SecretCipher {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

interface SecretFile {
  schemaVersion: 1
  providers: Record<string, string>
}

export type StoredCredentialStatus = 'missing' | 'ready' | 'unreadable'

const EMPTY_FILE: SecretFile = { schemaVersion: 1, providers: {} }

function parseSecretFile(raw: string): SecretFile {
  const parsed = JSON.parse(raw) as Partial<SecretFile>
  if (parsed.schemaVersion !== 1 || !parsed.providers || typeof parsed.providers !== 'object') {
    throw new Error('Unsupported AI secret-store format')
  }
  const providers: Record<string, string> = {}
  for (const [provider, value] of Object.entries(parsed.providers)) {
    if (typeof value === 'string' && value) providers[provider] = value
  }
  return { schemaVersion: 1, providers }
}

/**
 * Main-process-only encrypted API-key storage.
 *
 * The encrypted blobs are safe to persist, but callers must never return this
 * object or decrypted values over IPC. Writes use rename-on-complete so a
 * process interruption cannot leave a partially written JSON file.
 */
export class AiSecretStore {
  constructor(
    private readonly path: string,
    private readonly cipher: SecretCipher,
  ) {}

  isEncryptionAvailable(): boolean {
    return this.cipher.isAvailable()
  }

  has(providerId: string): boolean {
    return Boolean(this.read().providers[providerId])
  }

  status(providerId: string): StoredCredentialStatus {
    const encoded = this.read().providers[providerId]
    if (!encoded) return 'missing'
    if (!this.cipher.isAvailable()) return 'unreadable'
    try {
      this.cipher.decrypt(Buffer.from(encoded, 'base64'))
      return 'ready'
    } catch {
      return 'unreadable'
    }
  }

  get(providerId: string): string | null {
    const encoded = this.read().providers[providerId]
    if (!encoded) return null
    if (!this.cipher.isAvailable()) throw new Error('Secure credential storage is unavailable')
    try {
      return this.cipher.decrypt(Buffer.from(encoded, 'base64'))
    } catch {
      throw new Error(`Stored credential for ${providerId} could not be decrypted`)
    }
  }

  set(providerId: string, apiKey: string): void {
    const cleanProvider = providerId.trim()
    const cleanKey = apiKey.trim()
    if (!cleanProvider) throw new Error('Provider id is required')
    if (!cleanKey) throw new Error('API key is required')
    if (!this.cipher.isAvailable()) throw new Error('Secure credential storage is unavailable')
    const file = this.read()
    file.providers[cleanProvider] = this.cipher.encrypt(cleanKey).toString('base64')
    this.write(file)
  }

  remove(providerId: string): boolean {
    const file = this.read()
    if (!file.providers[providerId]) return false
    delete file.providers[providerId]
    this.write(file)
    return true
  }

  private read(): SecretFile {
    if (!existsSync(this.path)) return { ...EMPTY_FILE, providers: {} }
    try {
      return parseSecretFile(readFileSync(this.path, 'utf8'))
    } catch (error) {
      throw new Error(
        `AI credential store is unreadable: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  private write(file: SecretFile): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tempPath = `${this.path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tempPath, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(tempPath, this.path)
  }
}

/** Redact bearer/key-like values from provider errors before logging or IPC. */
export function redactProviderError(value: unknown, secrets: readonly string[] = []): string {
  let text = value instanceof Error ? value.message : String(value)
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('[REDACTED]')
  }
  return text
    .replace(/\bsk-(?:or-v1-|ant-api\d*-)?[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(x-api-key\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
}
