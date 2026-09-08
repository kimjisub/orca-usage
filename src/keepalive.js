import { CredentialError } from './credentials.js'
import { msUntil } from './format.js'
import { ensureToken } from './oauth.js'

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages'
// 창을 여는 데는 요청 하나면 된다. 가장 싼 모델에 토큰 하나. 실측 2026-09-07:
// 사용률이 정수 % 라 한 번은 0%p 로 보인다.
const OPENER_MODEL = 'claude-haiku-4-5-20251001'
const HTTP_TIMEOUT_MS = 15_000

// 시계가 돌아야 하는 창. 요청 하나면 둘 다 시작되지만, 리셋 주기가 달라 한쪽만
// 닫혀 있는 때가 온다.
const CYCLE_WINDOWS = ['5h', '7d']

/**
 * 창이 돌고 있지 않은 계정인가.
 *
 * 5h 와 7d 창은 첫 요청에서 시작한다. 안 쓰는 계정은 창이 아예 없거나(리셋 시각이
 * 없다) 닫힌 뒤 새로 열리지 않는다. 그동안은 리셋 시계가 서 있어서, 나중에 그
 * 계정을 쓰기 시작하면 그때부터 온전히 다섯 시간, 이레를 기다려야 한다.
 *
 * 둘을 따로 본다. 주기가 달라 5h 가 열려 있는데 7d 만 닫힌 때가 온다. 5h 만
 * 보면 그 계정의 주간 시계는 다음에 누가 쓸 때까지 선 채로 있다.
 */
export function needsOpening(row, now = Date.now()) {
  if (row.provider !== 'claude' || row.authFailed || !row.usage) return false
  const windows = row.usage.windows ?? []
  return CYCLE_WINDOWS.some((label) => {
    const window = windows.find((entry) => entry.label === label)
    if (!window) return true
    const left = msUntil(window.resetsAt, now)
    return left == null || left <= 0
  })
}

// 만료된 지 이만큼 지난 토큰은 우리가 갱신한다. Orca 는 쓰는 계정만 갱신해서,
// 안 쓰는 계정은 만료된 채 남는다. 실측 2026-09-07: 한 계정이 11시간째 만료
// 상태였고 다른 셋은 살아 있었다. 그보다 짧으면 Orca 가 곧 돌릴 수 있으니 둔다.
const REFRESH_AFTER_EXPIRY_MS = 60 * 60_000

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
    const stale = expired && Date.now() - peek.expiresAt >= REFRESH_AFTER_EXPIRY_MS
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
