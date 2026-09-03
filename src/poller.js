import { CredentialError } from './credentials.js'
import { REFRESH_MIN_GAP_MS, ensureToken, fetchUsage, normalize } from './oauth.js'
import { activeAccountId } from './orca-rpc.js'
import { appendHistory, loadCache, loadHistory, saveCache, saveHistory } from './store.js'

// 429 는 Retry-After: 0 으로 오는 일이 잦다. 그대로 믿으면 쉬지 않고 다시 때린다.
// 연속으로 막히면 배로 늘려 예산을 그만 태운다.
const MIN_BACKOFF_MS = 5 * 60_000
const MAX_BACKOFF_MS = 60 * 60_000
// 계정 사이 간격. 넷을 한꺼번에 때리면 429 를 자초한다.
const GAP_MS = 400

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 계정 목록을 한 바퀴 돌며 사용량을 갱신한다. 계정 하나가 끝날 때마다
 * onAccount 를 불러 화면이 순서대로 채워지게 한다.
 *
 * @param {object} options
 * @param {boolean} options.force        캐시와 백오프를 무시한다 (r 키)
 * @param {boolean} options.forceRefresh 만료 전이라도 토큰을 다시 만든다 (t 키)
 * @param {string[]} [options.only]      이 계정 id 만 돈다
 */
export async function pollOnce(accounts, {
  allowRefresh = true, force = false, forceRefresh = false, only = null,
  freshForMs = 270_000, onAccount = () => {},
} = {}) {
  const cache = loadCache()
  const history = loadHistory()
  const targets = only ? accounts.filter((a) => only.includes(a.id)) : accounts
  const rows = []

  // 활성 계정은 Orca 에 직접 묻는다. ~/.claude.json 은 Claude Code 가 로그인할
  // 때 쓰는 파일이라, Orca 에서 계정을 바꿔도 그 파일은 그대로다.
  let activeId = null
  try {
    activeId = await activeAccountId()
  } catch { /* 못 받으면 앞서 파일에서 읽은 값을 그대로 쓴다 */ }

  for (const [position, account] of targets.entries()) {
    const entry = { ...(cache[account.id] ?? {}) }
    const now = Date.now()
    const fresh = !force && now - (entry.fetchedAt ?? 0) < freshForMs
    const blocked = !force && now < (entry.retryUntil ?? 0)
    let note = null

    if (fresh) {
      // 캐시가 아직 신선하다. 호출 예산을 아낀다.
    } else if (blocked) {
      // 백오프 중이다. 화면은 retryUntil 로 남은 시간을 직접 보여준다.
    } else {
      if (position) await sleep(GAP_MS)
      let token = null
      try {
        const result = await ensureToken(account.id, {
          allowRefresh, lastRefreshAt: entry.refreshedAt ?? 0, force: forceRefresh,
        })
        token = result.token
        note = result.note
        entry.expiresAt = result.expiresAt ?? entry.expiresAt
        if (result.refreshed) {
          entry.refreshedAt = Date.now()
          // 갱신 성공은 백그라운드가 알아서 한 일이라 화면에 남길 이유가 없다.
          note = null
        }
        // 토큰을 받아 냈으니 앞서 남은 인증 실패는 풀린 것으로 본다.
        delete entry.authFailed
      } catch (error) {
        note = error instanceof CredentialError ? error.message : String(error)
        // 자격증명 자체가 안 되는 것은 조회 실패와 다르다. 백오프로 풀리지 않고
        // 사람이 다시 로그인해야 하므로 화면에서 따로 알린다.
        entry.authFailed = true
      }

      if (token) {
        const { data, error, retryAfter } = await fetchUsage(token)
        if (data) {
          const usage = normalize(data)
          entry.usage = usage
          entry.fetchedAt = Date.now()
          delete entry.retryUntil
          delete entry.blockedStreak
          appendHistory(history, account.id, usage.windows)
        } else if (error === '호출 예산 소진') {
          // 백오프는 스스로 풀리고 사용자가 할 일이 없다. 사유로 남기면 계정
          // 이름 옆이 늘 시끄러워지므로, 값이 오래 낡았을 때만 화면이 알린다.
          const streak = (entry.blockedStreak ?? 0) + 1
          entry.blockedStreak = streak
          const backoff = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** (streak - 1))
          entry.retryUntil = Date.now() + Math.max(backoff, (retryAfter ?? 0) * 1000)
        } else {
          note = note ? `${error} / ${note}` : error
          if (retryAfter) entry.retryUntil = Date.now() + retryAfter * 1000
        }
      }
    }

    cache[account.id] = entry
    const row = {
      ...account,
      active: activeId ? account.id === activeId : account.active,
      usage: entry.usage ?? null,
      fetchedAt: entry.fetchedAt ?? null,
      refreshedAt: entry.refreshedAt ?? null,
      expiresAt: entry.expiresAt ?? null,
      retryUntil: entry.retryUntil ?? null,
      authFailed: Boolean(entry.authFailed),
      note,
    }
    rows.push(row)
    onAccount(row)
  }

  saveCache(cache)
  saveHistory(history)
  return rows
}

/** 조회 없이 캐시만 읽어 첫 화면을 즉시 채운다. */
export function rowsFromCache(accounts) {
  const cache = loadCache()
  return accounts.map((account) => {
    const entry = cache[account.id] ?? {}
    return {
      ...account,
      usage: entry.usage ?? null,
      fetchedAt: entry.fetchedAt ?? null,
      refreshedAt: entry.refreshedAt ?? null,
      expiresAt: entry.expiresAt ?? null,
      retryUntil: entry.retryUntil ?? null,
      authFailed: Boolean(entry.authFailed),
      note: null,
    }
  })
}

export function nextRefreshDueAt(rows) {
  const stamps = rows.map((row) => row.refreshedAt).filter(Boolean)
  return stamps.length ? Math.min(...stamps) + REFRESH_MIN_GAP_MS : null
}
