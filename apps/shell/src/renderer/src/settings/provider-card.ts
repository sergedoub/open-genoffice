import type { PublicAiProvider } from '../../../../../docs/src/shared/ipc'

export function shouldShowGensparkLogin(provider: PublicAiProvider, canLogin: boolean): boolean {
  return provider.id === 'genspark' && provider.status === 'unavailable' && canLogin
}
