import { call } from './orca-rpc.js'
import { codexPlanLabel } from './codex-auth.js'
import { codexActiveId, systemCodexAccount } from './system-codex.js'

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

/** 다시 로그인해야 풀리는 실패인가. 기다린다고 낫지 않으므로 이름 색으로 알린다. */
const isAuthError = (error) => /token_revoked|invalidated oauth|401|unauthorized/i.test(String(error ?? ''))

/**
 * 실패 사유를 이름 옆에 들어갈 한 줄로 줄인다.
 *
 * Orca 가 주는 것은 주소와 헤더에 HTTP 응답 본문까지 담은 여러 줄짜리다.
 * 그대로 실으면 계정 한 줄을 통째로 먹으면서 정작 무엇을 해야 하는지는 그
 * 안에 묻힌다. 손쓸 방법이 갈리는 것만 따로 읽고 나머지는 첫 줄만 남긴다.
 */
function summarize(rateLimits) {
  const text = String(rateLimits?.error ?? '')
  if (!text) return rateLimits ? `Orca 조회 ${rateLimits.status}` : null
  if (isAuthError(text)) return 'Orca 에서 재로그인'
  if (/\b429\b|rate.?limit/i.test(text)) return '조회 한도 초과'
  const first = text.split('\n')[0].trim()
  return first.length > 60 ? `${first.slice(0, 57)}...` : first
}

/**
 * 한 계정의 한도를 행이 쓰는 모양으로 옮긴다.
 *
 * 조회가 실패해도 Orca 는 마지막으로 받아 둔 창을 함께 준다. Orca 앱 화면이
 * 그리는 값이 그것이라, 여기서 버리면 같은 계정을 두고 두 화면이 갈린다.
 * 실측 2026-09-21: codex@teamcandid.kr 의 토큰이 revoke 되어 status 는 error
 * 인데 weekly 는 2% 로 실려 왔고, Orca 화면에는 그 2% 가 보였다.
 * 값은 쓰되 stale 로 표시해 부르는 쪽이 이력에 쌓을지 가릴 수 있게 한다.
 */
function entryOf(rateLimits) {
  const ok = Boolean(rateLimits) && rateLimits.status === 'ok' && !rateLimits.error
  const windows = windowsOf(rateLimits)
  return {
    usage: windows.length ? { windows } : null,
    credits: creditsOf(rateLimits),
    fetchedAt: rateLimits?.updatedAt ?? null,
    stale: !ok,
    authFailed: !ok && isAuthError(rateLimits?.error),
    note: ok ? null : summarize(rateLimits),
  }
}

/**
 * provider 하나의 계정 id 별 한도. 활성 계정은 목록이 아니라 위쪽에 따로 실려
 * 온다. Codex 가 시스템 기본 로그인으로 돌고 있으면 그 한도는 시스템 기본의 것이다.
 */
function limitsById(payload, provider) {
  const byId = new Map()
  const inactiveKey = provider === 'claude' ? 'inactiveClaudeAccounts' : 'inactiveCodexAccounts'
  for (const entry of payload?.rateLimits?.[inactiveKey] ?? []) {
    if (entry?.accountId) byId.set(entry.accountId, entry.rateLimits)
  }
  const activeId = provider === 'codex' ? codexActiveId(payload) : payload?.[provider]?.activeAccountId
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
    // Claude 의 요금제 꼬리표와 같은 자리에 선다. 계정마다 한도가 갈리는데
    // Codex 쪽만 비어 있으면 어느 것이 큰 계정인지 화면에서 알 수 없다.
    label: codexPlanLabel(account.id, account.workspaceLabel),
    ...(codexById.get(account.id) ?? entryOf(null)),
  }))
  // 시스템 기본 로그인은 목록 끝에 선다. 쓰고 있지 않을 때는 사용량이 안 와서
  // 마지막으로 받은 값이 캐시에서 보인다.
  const system = systemCodexAccount(payload)
  if (system) {
    const plan = codexPlanLabel(null)
    codexAccounts.push({
      ...system,
      provider: 'codex',
      label: plan ? `${plan}, 시스템 기본` : '시스템 기본',
      ...(codexById.get(system.id) ?? entryOf(null)),
    })
  }

  return {
    claude: { activeId: payload?.claude?.activeAccountId ?? null, byId: claudeById },
    codex: { activeId: codexActiveId(payload), byId: codexById, accounts: codexAccounts },
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
