import { msUntil } from './format.js'

/**
 * 백엔드가 스스로 손을 대는 기준. 입출력 없이 값만 보고 정한다.
 *
 * 토큰과 창은 Orca 와 우리가 함께 만지는 자원이라, 누가 언제 손대는지가 한 곳에
 * 적혀 있어야 한다. 화면의 t 키와 백엔드의 주기 재인증이 이 기준을 같이 쓴다.
 */

// 만료된 지 이만큼 지난 토큰은 우리가 갱신한다. Orca 는 쓰는 계정만 갱신해서,
// 안 쓰는 계정은 만료된 채 남는다. 실측 2026-09-07: 한 계정이 11시간째 만료
// 상태였고 다른 셋은 살아 있었다. 그보다 짧으면 Orca 가 곧 돌릴 수 있으니 둔다.
// 둘이 같은 refresh token 을 함께 돌리면 rotation 에 한쪽이 revoke 된다.
export const REFRESH_AFTER_EXPIRY_MS = 60 * 60_000

// 시계가 돌아야 하는 창. 요청 하나면 둘 다 시작되지만, 리셋 주기가 달라 한쪽만
// 닫혀 있는 때가 온다.
const CYCLE_WINDOWS = ['5h', '7d']

/** 만료된 지 얼마나 됐나. 아직 살아 있으면 음수, 만료 시각을 모르면 null 이다. */
export function expiredFor(expiresAt, now = Date.now()) {
  return typeof expiresAt === 'number' ? now - expiresAt : null
}

/** Orca 가 손을 놓은 토큰인가. 이것만 우리가 갱신한다. */
export function isAbandoned(expiresAt, now = Date.now()) {
  const age = expiredFor(expiresAt, now)
  return age != null && age >= REFRESH_AFTER_EXPIRY_MS
}

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

/**
 * 손으로 누른 토큰 갱신(t)을 받을지. 받지 않으면 이유를 돌려준다.
 *
 * Orca 가 떠 있지 않으면 토큰을 돌리는 쪽이 우리뿐이라 언제든 된다.
 *
 * @returns {string|null} 거절 사유. 받으면 null
 */
export function refuseManualRefresh(account, { orcaConnected, expiresAt, now = Date.now() }) {
  if (!account) return '계정을 먼저 고르세요'
  if (account.provider !== 'claude') return 'Codex 토큰은 Orca 만 다룹니다'
  if (!orcaConnected) return null
  if (isAbandoned(expiresAt, now)) return null
  return 'Orca 가 토큰을 관리 중입니다. 만료된 지 한 시간 넘은 계정만 손으로 갱신합니다'
}
