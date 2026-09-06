import { call } from './orca-rpc.js'

/**
 * 계정과 사용량을 Orca 에서 받는다.
 *
 * Orca 는 Claude 와 Codex 모두 계정별 한도를 이미 들고 있고, Claude 는 우리와
 * 같은 엔드포인트를 같은 키체인 자격증명으로 친다. 사용량 엔드포인트는 계정당
 * 5분에 5회라, 둘이 따로 치면 활성 계정이 그 예산을 넘겨 429 백오프에 걸린다.
 * 실측 2026-09-06: 활성 계정만 12분 전 값에 머물고 나머지 셋은 2분 전이었다.
 * 한쪽만 치게 하려면 이미 치고 있는 Orca 의 값을 받는 편이 맞다.
 *
 * refreshUsage 를 켜면 Orca 가 그 자리에서 전 계정을 다시 조회한다. 2초쯤
 * 걸리므로 화면을 처음 채울 때는 끄고 폴링에서만 켠다.
 */

/** 창 길이를 직접 조회 경로와 같은 라벨로 맞춘다. 라벨이 같아야 히스토리가 이어진다. */
function labelFor(windowMinutes) {
  if (windowMinutes === 300) return '5h'
  if (windowMinutes === 10080) return '7d'
  if (!windowMinutes) return '?'
  if (windowMinutes % 1440 === 0) return `${windowMinutes / 1440}d`
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}h`
  return `${windowMinutes}m`
}

/**
 * 모델별 창의 키에서 이름을 뽑는다. Orca 는 fableWeekly 처럼 준다. 직접 조회
 * 경로는 API 의 display_name 을 쓰는데 Fable 은 둘이 같다고 확인했다.
 */
function modelLabel(key) {
  const name = key.replace(/Weekly$/, '')
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Orca 가 준 한도 한 벌을 화면이 쓰는 창 목록으로 옮긴다. 계정 창이 앞, 모델 창이 뒤다. */
function windowsOf(rateLimits) {
  const windows = []
  const push = (label, window) => {
    if (!window || typeof window.usedPercent !== 'number') return
    windows.push({
      label,
      pct: window.usedPercent,
      resetsAt: window.resetsAt ? new Date(window.resetsAt).toISOString() : null,
    })
  }
  push(labelFor(rateLimits?.session?.windowMinutes), rateLimits?.session)
  push(labelFor(rateLimits?.weekly?.windowMinutes), rateLimits?.weekly)
  for (const key of Object.keys(rateLimits ?? {})) {
    if (key !== 'weekly' && key.endsWith('Weekly')) push(modelLabel(key), rateLimits[key])
  }
  return windows
}

/**
 * 한도 리셋 크레딧. Codex 에만 있다. 창으로 접지 않고 따로 나른다. 쓰면 짧은
 * 창이 즉시 비므로, 남은 개수가 곧 "몇 번 더 버틸 수 있나" 다.
 */
function creditsOf(rateLimits) {
  const credits = rateLimits?.rateLimitResetCredits
  if (!credits || typeof credits.availableCount !== 'number') return null
  return { available: credits.availableCount, nextExpiresAt: credits.nextExpiresAt ?? null }
}

/** 한 계정의 한도를 행이 쓰는 모양으로 옮긴다. 조회가 실패한 계정은 usage 가 비고 사유가 남는다. */
function entryOf(rateLimits) {
  const ok = rateLimits && rateLimits.status === 'ok' && !rateLimits.error
  return {
    usage: ok ? { windows: windowsOf(rateLimits) } : null,
    credits: creditsOf(rateLimits),
    fetchedAt: rateLimits?.updatedAt ?? null,
    note: ok ? null : (rateLimits?.error ?? (rateLimits ? `Orca 조회 ${rateLimits.status}` : null)),
  }
}

/** provider 하나의 계정 id 별 한도. 활성 계정은 목록이 아니라 위쪽에 따로 실려 온다. */
function limitsById(payload, provider) {
  const byId = new Map()
  const inactiveKey = provider === 'claude' ? 'inactiveClaudeAccounts' : 'inactiveCodexAccounts'
  for (const entry of payload?.rateLimits?.[inactiveKey] ?? []) {
    if (entry?.accountId) byId.set(entry.accountId, entry.rateLimits)
  }
  const activeId = payload?.[provider]?.activeAccountId
  if (activeId && payload?.rateLimits?.[provider]) byId.set(activeId, payload.rateLimits[provider])
  return byId
}

/**
 * Orca 가 아는 계정과 사용량 전부.
 *
 * @returns {Promise<{
 *   claude: { activeId: string|null, byId: Map<string, object> },
 *   codex: { activeId: string|null, byId: Map<string, object>, accounts: object[] },
 * }>}
 */
export async function fetchOrcaLimits({ refreshUsage = false } = {}) {
  const payload = await call('accounts.list', { refreshUsage })

  const claudeById = new Map()
  for (const [id, rateLimits] of limitsById(payload, 'claude')) claudeById.set(id, entryOf(rateLimits))

  const codexById = new Map()
  for (const [id, rateLimits] of limitsById(payload, 'codex')) codexById.set(id, entryOf(rateLimits))
  const codexAccounts = (payload?.codex?.accounts ?? []).map((account) => ({
    id: account.id,
    email: account.email ?? account.id.slice(0, 8),
    provider: 'codex',
    // Codex 는 요금제를 알려 주지 않는다. 자리를 비워 두면 이름 뒤가 깔끔하다.
    label: '',
    ...(codexById.get(account.id) ?? entryOf(null)),
  }))

  return {
    claude: { activeId: payload?.claude?.activeAccountId ?? null, byId: claudeById },
    codex: { activeId: payload?.codex?.activeAccountId ?? null, byId: codexById, accounts: codexAccounts },
  }
}

/** Codex 계정 목록만. 계정을 세울 때 쓴다. */
export async function fetchCodex({ refreshUsage = false } = {}) {
  const { codex } = await fetchOrcaLimits({ refreshUsage })
  return { activeId: codex.activeId, accounts: codex.accounts }
}

/** Orca 의 활성 Codex 계정을 바꾼다. */
export async function selectCodexAccount(accountId) {
  await call('accounts.selectCodex', { accountId })
}
