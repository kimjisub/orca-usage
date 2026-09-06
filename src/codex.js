import { call } from './orca-rpc.js'

/**
 * Codex 계정과 사용량은 Orca 에서 받는다.
 *
 * Claude 는 계정마다 키체인에 자격증명이 있어 우리가 직접 Anthropic 에 묻지만,
 * Codex 는 Orca 가 이미 계정별로 한도를 들고 있다. 같은 것을 두 번 조회할
 * 이유가 없고, 자격증명을 만지지 않으니 갱신 실패로 남의 토큰을 깨뜨릴 일도
 * 없다.
 */

/** 창 길이를 Claude 쪽과 같은 라벨로 맞춘다. 라벨이 같아야 그래프와 막대가 함께 선다. */
function labelFor(windowMinutes) {
  if (windowMinutes === 300) return '5h'
  if (windowMinutes === 10080) return '7d'
  if (!windowMinutes) return '?'
  if (windowMinutes % 1440 === 0) return `${windowMinutes / 1440}d`
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`
  return `${windowMinutes}m`
}

/** Orca 가 준 한도 한 벌을 화면이 쓰는 창 목록으로 옮긴다. */
function windowsOf(rateLimits) {
  const windows = []
  for (const key of ['session', 'weekly']) {
    const window = rateLimits?.[key]
    if (!window || typeof window.usedPercent !== 'number') continue
    windows.push({
      label: labelFor(window.windowMinutes),
      pct: window.usedPercent,
      resetsAt: window.resetsAt ? new Date(window.resetsAt).toISOString() : null,
    })
  }
  return windows
}

/**
 * 한도 리셋 크레딧. Claude 에는 없는 개념이라 창으로 접지 않고 따로 나른다.
 * 쓰면 5시간 창이 즉시 비므로, 남은 개수가 곧 "몇 번 더 버틸 수 있나" 다.
 */
function creditsOf(rateLimits) {
  const credits = rateLimits?.rateLimitResetCredits
  if (!credits || typeof credits.availableCount !== 'number') return null
  return { available: credits.availableCount, nextExpiresAt: credits.nextExpiresAt ?? null }
}

/** 계정 id 로 한도를 찾는다. 활성 계정은 목록이 아니라 위쪽에 따로 실려 온다. */
function rateLimitsById(payload) {
  const byId = new Map()
  for (const entry of payload?.rateLimits?.inactiveCodexAccounts ?? []) {
    if (entry?.accountId) byId.set(entry.accountId, entry.rateLimits)
  }
  const activeId = payload?.codex?.activeAccountId
  if (activeId && payload?.rateLimits?.codex) byId.set(activeId, payload.rateLimits.codex)
  return byId
}

/**
 * Codex 계정 목록과 사용량을 한 번에 읽는다.
 *
 * refreshUsage 를 켜면 Orca 가 그 자리에서 다시 조회한다. 2초쯤 걸리므로
 * 화면을 처음 채울 때는 끄고, 사용자가 조회를 부를 때만 켠다.
 */
export async function fetchCodex({ refreshUsage = false } = {}) {
  const payload = await call('accounts.list', { refreshUsage })
  const byId = rateLimitsById(payload)
  const activeId = payload?.codex?.activeAccountId ?? null

  return {
    activeId,
    accounts: (payload?.codex?.accounts ?? []).map((account) => {
      const rateLimits = byId.get(account.id) ?? null
      return {
        id: account.id,
        email: account.email ?? account.id.slice(0, 8),
        provider: 'codex',
        // Codex 는 요금제를 알려 주지 않는다. 자리를 비워 두면 이름 뒤가 깔끔하다.
        label: '',
        usage: rateLimits ? { windows: windowsOf(rateLimits), spend: null } : null,
        credits: creditsOf(rateLimits),
        fetchedAt: rateLimits?.updatedAt ?? null,
        note: rateLimits?.error ?? null,
      }
    }),
  }
}

/** Orca 의 활성 Codex 계정을 바꾼다. */
export async function selectCodexAccount(accountId) {
  await call('accounts.selectCodex', { accountId })
}
