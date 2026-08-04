import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AiSecretStore, redactProviderError, type SecretCipher } from '../src/main/ai-secret-store'

class TestCipher implements SecretCipher {
  available = true

  isAvailable(): boolean {
    return this.available
  }

  encrypt(value: string): Buffer {
    return Buffer.from(`enc:${value}`, 'utf8')
  }

  decrypt(value: Buffer): string {
    const decoded = value.toString('utf8')
    if (!decoded.startsWith('enc:')) throw new Error('bad ciphertext')
    return decoded.slice(4)
  }
}

function fixture(): { path: string; cipher: TestCipher; store: AiSecretStore } {
  const path = join(mkdtempSync(join(tmpdir(), 'genoffice-secrets-')), 'ai-secrets.json')
  const cipher = new TestCipher()
  return { path, cipher, store: new AiSecretStore(path, cipher) }
}

describe('AiSecretStore', () => {
  it('round-trips encrypted provider keys without writing plaintext', () => {
    const { path, store } = fixture()
    store.set('openrouter', 'sk-or-v1-secret-value')
    expect(store.has('openrouter')).toBe(true)
    expect(store.get('openrouter')).toBe('sk-or-v1-secret-value')
    expect(readFileSync(path, 'utf8')).not.toContain('sk-or-v1-secret-value')
  })

  it('removes one provider without touching another', () => {
    const { store } = fixture()
    store.set('openrouter', 'or-key')
    store.set('openai', 'oa-key')
    expect(store.remove('openrouter')).toBe(true)
    expect(store.get('openrouter')).toBeNull()
    expect(store.get('openai')).toBe('oa-key')
  })

  it('reports ciphertext that cannot be decrypted without deleting it', () => {
    const { path, store } = fixture()
    store.set('openrouter', 'or-key')
    const persisted = JSON.parse(readFileSync(path, 'utf8'))
    persisted.providers.openrouter = Buffer.from('wrong-ciphertext', 'utf8').toString('base64')
    writeFileSync(path, JSON.stringify(persisted))

    expect(store.has('openrouter')).toBe(true)
    expect(store.status('openrouter')).toBe('unreadable')
    expect(() => store.get('openrouter')).toThrow('could not be decrypted')
    expect(store.has('openrouter')).toBe(true)
  })

  it('fails closed when encryption is unavailable', () => {
    const { cipher, store } = fixture()
    cipher.available = false
    expect(() => store.set('openrouter', 'secret')).toThrow('Secure credential storage')
  })

  it('redacts common provider credentials and explicit secrets', () => {
    expect(
      redactProviderError(
        'Authorization: Bearer sk-or-v1-abcdefghijk x-api-key=sk-ant-api03-abcdefghijk custom-token',
        ['custom-token'],
      ),
    ).toBe('Authorization: Bearer [REDACTED] x-api-key=[REDACTED] [REDACTED]')
  })
})
