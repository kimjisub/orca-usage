import { CredentialError } from './credentials.js'
import { isAbandoned } from '../../core/policy.js'
import { ensureToken } from './oauth.js'

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
// 창을 여는 데는 요청 하나면 된다. 가장 싼 모델에 토큰 하나. 실측 2026-09-07:
// 사용률이 정수 % 라 한 번은 0%p 로 보인다.
const OPENER_MODEL = 'claude-haiku-4-5-20251001'
const HTTP_TIMEOUT_MS = 15_000

/**
 * 창을 연다. 토큰이 살아 있으면 읽기만 한다. 만료된 지 오래면 갱신해 되쓴다.
 * 이 계정은 바로 창이 안 도는 계정이라 Orca 도 손을 놓은 상태다.
 *
 * @returns {Promise<{ok: true, refreshed: boolean} | {ok: false, reason: string, refreshed?: boolean}>}
 */
export async function openWindow(accountId) {
  let token
  let refreshed = false
  try {
    // 만료 직후에는 갱신하지 않는다. lastRefreshAt 을 0 으로 주어 간격 제한은 안 건다.
    const peek = await ensureToken(accountId, { allowRefresh: false, lastRefreshAt: 0 })
    const expired = typeof peek.expiresAt === 'number' && Date.now() >= peek.expiresAt
    const stale = isAbandoned(peek.expiresAt)
    if (expired && !stale) return { ok: false, reason: '토큰 만료 (Orca 갱신 대기)' }
    const result = stale
      ? await ensureToken(accountId, { allowRefresh: true, lastRefreshAt: 0, force: true })
      : peek
    if (result.authFailed) return { ok: false, reason: result.note ?? '인증 실패' }
    if (!result.token) return { ok: false, reason: '토큰 없음' }
    if (typeof result.expiresAt === 'number' && Date.now() >= result.expiresAt) {
      return { ok: false, reason: result.note ?? '토큰 만료' }
    }
    token = result.token
    refreshed = Boolean(result.refreshed)
  } catch (error) {
    return { ok: false, reason: error instanceof CredentialError ? error.message : '자격증명 읽기 실패' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const response = await fetch(MESSAGES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'oauth-2025-04-20',
        'Content-Type': 'application/json',
        'User-Agent': 'orca-usage/1.0',
      },
      body: JSON.stringify({
        model: OPENER_MODEL,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}`, refreshed }
    return { ok: true, refreshed }
  } catch {
    return { ok: false, reason: '요청 실패' }
  } finally {
    clearTimeout(timer)
  }
}
