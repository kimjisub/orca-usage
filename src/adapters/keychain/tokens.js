import { fingerprintOf } from '../../core/fingerprint.js'
import { readCredentials } from './credentials.js'
import { ensureToken } from './oauth.js'

/**
 * 키체인의 토큰을 읽기만 한다. 갱신하지 않는다.
 *
 * 액세스 토큰은 만료 시각을, 리프레시 토큰은 지문과 만료 시각을 돌려준다.
 * 원문은 이 함수를 벗어나지 않는다. 리프레시 토큰의 만료는 Claude Code 가
 * 갱신 응답의 refresh_token_expires_in 으로 적어 두는 값이다.
 *
 * @returns {Promise<{expiresAt: number|null, refresh: string|null, refreshExpiresAt: number|null}>}
 */
export async function peekToken(accountId) {
  const oauth = JSON.parse(await readCredentials(accountId)).claudeAiOauth ?? {}
  return {
    expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
    refresh: fingerprintOf(oauth.refreshToken),
    refreshExpiresAt: typeof oauth.refreshTokenExpiresAt === 'number' ? oauth.refreshTokenExpiresAt : null,
  }
}

/**
 * 지금 갱신한다. 언제 해도 되는지는 부르는 쪽이 core/policy 로 정한다.
 *
 * revoked 는 발급처가 리프레시 토큰을 폐기했다고 답한 경우다(invalid_grant).
 *
 * @returns {Promise<{refreshed: boolean, expiresAt: number|null, note: string|null, authFailed: boolean, revoked: boolean}>}
 */
export async function refreshNow(accountId) {
  const result = await ensureToken(accountId, { allowRefresh: true, lastRefreshAt: 0, force: true })
  return {
    refreshed: Boolean(result.refreshed),
    expiresAt: typeof result.expiresAt === 'number' ? result.expiresAt : null,
    note: result.refreshed ? null : (result.note ?? null),
    authFailed: Boolean(result.authFailed),
    revoked: Boolean(result.revoked),
  }
}
