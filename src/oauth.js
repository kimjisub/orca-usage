import {
  CredentialError, backupCredentials, readCredentials, withRefreshLock, writeCredentials,
} from './credentials.js'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const OAUTH_BETA = 'oauth-2025-04-20'
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const HTTP_TIMEOUT_MS = 10_000

// 액세스 토큰 수명이 8시간이다. 이 여유로 계정당 하루 세 번쯤 갱신한다.
export const EXPIRY_BUFFER_MS = 30 * 60_000
// 같은 계정을 이 간격 안에 두 번 갱신하지 않는다. 갱신은 리프레시 토큰을
// 회전시키므로 루프가 헛돌면 회전만 반복하게 된다.
export const REFRESH_MIN_GAP_MS = 30 * 60_000

function timeout(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, done: () => clearTimeout(timer) }
}

/**
 * 갱신된 자격증명 JSON 문자열. 실패하면 { error } 를 담아 원본을 돌려준다.
 *
 * fatal 은 사람이 Orca 에서 다시 로그인해야 풀리는 실패다. 네트워크가 끊겼거나
 * 서버가 5xx 를 준 것은 다음 조회에 나을 수 있으므로 여기 들지 않는다.
 */
async function refreshCredentials(payload) {
  let data
  try {
    data = JSON.parse(payload)
  } catch {
    return { payload, error: '자격증명 형식 이상', fatal: true }
  }
  const oauth = data.claudeAiOauth
  if (!oauth?.refreshToken) return { payload, error: '리프레시 토큰 없음', fatal: true }

  const guard = timeout(HTTP_TIMEOUT_MS)
  let response
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'orca-usage/1.0' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: oauth.refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
      signal: guard.signal,
    })
  } catch {
    return { payload, error: '갱신 요청 실패' }
  } finally {
    guard.done()
  }

  if (!response.ok) {
    let marker = null
    try {
      marker = JSON.parse(await response.text()).error
    } catch { /* 본문이 JSON 이 아니면 코드로만 판단한다 */ }
    if (marker === 'invalid_grant') {
      return { payload, error: '리프레시 토큰 폐기됨 (Orca 에서 재로그인이 필요합니다)', fatal: true }
    }
    if (marker === 'invalid_client') return { payload, error: '클라이언트 거부됨', fatal: true }
    return { payload, error: `갱신 실패 HTTP ${response.status}` }
  }

  const granted = await response.json()
  if (!granted.access_token) return { payload, error: '갱신 응답에 토큰 없음' }
  oauth.accessToken = granted.access_token
  oauth.expiresAt = Date.now() + (granted.expires_in ?? 0) * 1000
  if (granted.refresh_token) oauth.refreshToken = granted.refresh_token
  if (granted.scope) oauth.scopes = granted.scope.split(' ')
  data.claudeAiOauth = oauth
  return { payload: JSON.stringify(data), error: null }
}

/**
 * 쓸 수 있는 액세스 토큰을 돌려준다. 만료가 임박했고 갱신이 허용되면 갱신하고
 * Orca 가 읽는 바로 그 키체인 항목에 되쓴다.
 *
 * @returns {{token: string|null, note: string|null, refreshed: boolean, expiresAt: number|null}}
 */
export async function ensureToken(accountId, { allowRefresh, lastRefreshAt = 0, force = false }) {
  let payload = await readCredentials(accountId)
  let oauth = JSON.parse(payload).claudeAiOauth ?? {}
  const stale = force ||
    (typeof oauth.expiresAt === 'number' && Date.now() + EXPIRY_BUFFER_MS >= oauth.expiresAt)

  if (!stale) {
    return { token: oauth.accessToken, note: null, refreshed: false, expiresAt: oauth.expiresAt }
  }
  const base = {
    token: oauth.accessToken, refreshed: false, expiresAt: oauth.expiresAt, authFailed: false,
  }
  if (!allowRefresh) return { ...base, note: '토큰 만료 (갱신이 꺼져 있습니다)' }
  if (!force && Date.now() - lastRefreshAt < REFRESH_MIN_GAP_MS) {
    return { ...base, note: '토큰 만료 (직전 갱신이 최근이라 건너뜁니다)' }
  }

  const { acquired, value } = await withRefreshLock(async () => {
    // 잠금을 잡는 사이 다른 쪽이 이미 갱신했을 수 있다. 다시 읽어 확인한다.
    payload = await readCredentials(accountId)
    oauth = JSON.parse(payload).claudeAiOauth ?? {}
    if (!force && typeof oauth.expiresAt === 'number' &&
        Date.now() + EXPIRY_BUFFER_MS < oauth.expiresAt) {
      return { token: oauth.accessToken, note: null, refreshed: false, expiresAt: oauth.expiresAt }
    }

    const result = await refreshCredentials(payload)
    if (result.error) {
      return {
        token: oauth.accessToken,
        note: result.error,
        refreshed: false,
        expiresAt: oauth.expiresAt,
        authFailed: Boolean(result.fatal),
      }
    }

    // 되쓰기가 이 작업의 위험한 부분이다. 원본을 남기고, 쓰고, 다시 읽어 맞는지 본다.
    const backup = backupCredentials(accountId, payload)
    try {
      await writeCredentials(accountId, result.payload)
    } catch (error) {
      throw new CredentialError(
        `${error.message} - 새 토큰이 저장되지 않아 Orca 의 토큰이 죽었을 수 있습니다. 백업: ${backup}`)
    }
    if (await readCredentials(accountId) !== result.payload) {
      throw new CredentialError(`키체인에 쓴 값이 다시 읽히지 않습니다. 백업: ${backup}`)
    }
    const fresh = JSON.parse(result.payload).claudeAiOauth
    return { token: fresh.accessToken, note: '토큰 갱신함', refreshed: true, expiresAt: fresh.expiresAt }
  })

  if (!acquired) return { ...base, note: '토큰 만료 (다른 곳에서 갱신 중입니다)' }
  return value
}

/** @returns {{data: object|null, error: string|null, retryAfter: number|null}} */
export async function fetchUsage(token) {
  const guard = timeout(HTTP_TIMEOUT_MS)
  let response
  try {
    response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': OAUTH_BETA,
        'User-Agent': 'orca-usage/1.0',
      },
      signal: guard.signal,
    })
  } catch {
    return { data: null, error: '네트워크 실패', retryAfter: null }
  } finally {
    guard.done()
  }

  if (response.ok) {
    try {
      return { data: await response.json(), error: null, retryAfter: null }
    } catch {
      return { data: null, error: '응답 이상', retryAfter: null }
    }
  }
  const raw = response.headers.get('retry-after')
  const retryAfter = raw !== null && raw !== '' && Number.isFinite(Number(raw))
    ? Math.max(0, Number(raw))
    : null
  if (response.status === 429) return { data: null, error: '호출 예산 소진', retryAfter }
  if (response.status === 401 || response.status === 403) {
    return { data: null, error: '인증 거부', retryAfter: null }
  }
  return { data: null, error: `HTTP ${response.status}`, retryAfter }
}

/** 응답에서 화면에 쓸 창만 추린다. */
export function normalize(data) {
  const windows = []
  for (const [key, label] of [['five_hour', '5h'], ['seven_day', '7d']]) {
    const window = data?.[key]
    if (window && typeof window.utilization === 'number') {
      windows.push({ label, pct: window.utilization, resetsAt: window.resets_at ?? null })
    }
  }
  for (const limit of data?.limits ?? []) {
    const name = limit?.scope?.model?.display_name
    if (name && typeof limit.percent === 'number') {
      windows.push({ label: name, pct: limit.percent, resetsAt: limit.resets_at ?? null })
    }
  }
  const extra = data?.extra_usage
  const spend = extra?.is_enabled && extra.used_credits != null && extra.monthly_limit != null
    ? {
        used: extra.used_credits / 100,
        limit: extra.monthly_limit / 100,
        currency: extra.currency ?? 'USD',
      }
    : null
  return { windows, spend }
}
