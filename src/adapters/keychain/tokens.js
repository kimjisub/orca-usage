import { ensureToken } from './oauth.js'

/**
 * 토큰의 만료 시각만 읽는다. 갱신하지 않는다.
 *
 * @returns {Promise<number|null>}
 */
export async function peekExpiry(accountId) {
  const result = await ensureToken(accountId, { allowRefresh: false, lastRefreshAt: 0 })
  return typeof result.expiresAt === 'number' ? result.expiresAt : null
}

/**
 * 지금 갱신한다. 언제 해도 되는지는 부르는 쪽이 core/policy 로 정한다.
 *
 * @returns {Promise<{refreshed: boolean, expiresAt: number|null, note: string|null, authFailed: boolean}>}
 */
export async function refreshNow(accountId) {
  const result = await ensureToken(accountId, { allowRefresh: true, lastRefreshAt: 0, force: true })
  return {
    refreshed: Boolean(result.refreshed),
    expiresAt: typeof result.expiresAt === 'number' ? result.expiresAt : null,
    note: result.refreshed ? null : (result.note ?? null),
    authFailed: Boolean(result.authFailed),
  }
}
