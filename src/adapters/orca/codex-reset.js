import { randomUUID } from 'node:crypto'
import { call } from './orca-rpc.js'

/**
 * Codex 리셋 크레딧을 Orca 로 쓴다.
 *
 * Orca 런타임 RPC accounts.consumeCodexResetCredit 가 chatgpt.com 의
 * rate-limit-reset-credits/consume 을 부른다(Orca 1.4.204 에서 확인, 2026-09-30).
 * Orca 는 멱등 키마다 결과를 원장에 남겨 같은 크레딧을 두 번 쓰지 않는다.
 *
 * 쓸 수 있는 것은 Orca 가 지금 고른 Codex 계정뿐이다. 요청에는 그 계정과 제안의
 * 모양(expectedScope)을 함께 보내고, 그사이 무엇이든 바뀌었으면 Orca 가 크레딧을
 * 쓰지 않고 거절한다(rejectedBeforeProvider). 그래서 다른 계정이면 먼저 그 계정으로
 * 옮기고, 새 한도를 받은 뒤 쓰고, 원래 계정으로 되돌린다.
 */

// Orca 가 외부 API 를 부른다. 답이 늦으면 결과를 모르는 채로 남으므로 넉넉히 준다.
const CONSUME_TIMEOUT_MS = 60_000
// 계정을 옮긴 뒤 Orca 가 그 계정의 한도를 받아 오기를 기다리는 시간.
const SWITCH_WAIT_MS = 20_000
const POLL_MS = 1_000

const windowKey = (window) => (window ? [window.usedPercent, window.windowMinutes, window.resetsAt] : null)

/**
 * 제안의 지문. Orca 가 같은 식(Gaa)으로 만들어 요청에 온 것과 견준다. 한 글자라도
 * 다르면 offerChanged 로 거절되고 크레딧은 쓰이지 않는다.
 */
export function offerRevision(limits) {
  const credits = limits.rateLimitResetCredits
  const entries = [...(credits?.credits ?? [])]
    .map((entry) => [entry.status, entry.expiresAt, entry.grantedAt])
    .sort((a, b) => {
      const x = JSON.stringify(a)
      const y = JSON.stringify(b)
      return x < y ? -1 : x > y ? 1 : 0
    })
  return `v1:${JSON.stringify([
    credits?.availableCount ?? 0,
    credits?.totalEarnedCount ?? null,
    credits?.nextExpiresAt ?? null,
    entries,
    windowKey(limits.session),
    windowKey(limits.weekly),
    limits.updatedAt,
  ])}`
}

/** 지금 고른 계정에 대한 요청 범위. 쓸 크레딧이 없거나 모양이 안 맞으면 null. */
export function expectedScope(payload, accountId) {
  const account = payload?.codex?.accounts?.find((entry) => entry.id === accountId)
  const limits = payload?.rateLimits?.codex
  if (!account || limits?.provider !== 'codex') return null
  if ((limits.rateLimitResetCredits?.availableCount ?? 0) <= 0) return null
  if ((account.managedHomeRuntime ?? 'host') !== 'host') return null
  return {
    target: { runtime: 'host', wslDistro: null },
    accountId,
    accountRevision: account.updatedAt,
    offerRevision: offerRevision(limits),
  }
}

const hostActive = (payload) => payload?.codex?.activeAccountIdsByRuntime?.host ?? payload?.codex?.activeAccountId ?? null
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 계정을 옮긴 뒤 그 계정의 한도가 올 때까지 기다린다. */
async function waitForLimits(since) {
  const deadline = Date.now() + SWITCH_WAIT_MS
  let refresh = true
  while (Date.now() < deadline) {
    const payload = await call('accounts.list', { refreshUsage: refresh }, { timeoutMs: SWITCH_WAIT_MS })
    refresh = false
    if ((payload?.rateLimits?.codex?.updatedAt ?? 0) >= since) return payload
    await sleep(POLL_MS)
  }
  return null
}

/**
 * 한 Codex 계정의 리셋 크레딧 하나를 쓴다.
 *
 * @returns {Promise<{outcome: string, reason?: string, restored: boolean}>}
 *   outcome 은 Orca 의 reset, nothingToReset, noCredit, alreadyRedeemed 이거나
 *   Orca 가 쓰기 전에 거절한 rejected 다. restored 는 원래 계정으로 돌아갔는가
 */
export async function consumeCodexResetCredit(accountId) {
  let payload = await call('accounts.list', { refreshUsage: false })
  if (!payload?.codex?.accounts?.some((entry) => entry.id === accountId)) {
    throw new Error('Orca 가 관리하는 Codex 계정이 아닙니다')
  }
  const original = hostActive(payload)
  const switched = original !== accountId
  let outcome
  let failure = null
  try {
    if (switched) {
      const since = Date.now()
      await call('accounts.selectCodex', { accountId })
      payload = await waitForLimits(since)
      if (!payload) throw new Error('옮긴 계정의 한도를 Orca 가 받아 오지 않았습니다. 크레딧은 쓰지 않았습니다')
    }
    const scope = expectedScope(payload, accountId)
    if (!scope) throw new Error('이 계정에 쓸 리셋 크레딧이 없습니다')
    const result = await call('accounts.consumeCodexResetCredit',
      { idempotencyKey: randomUUID(), expectedScope: scope }, { timeoutMs: CONSUME_TIMEOUT_MS })
    outcome = result?.status === 'rejectedBeforeProvider'
      ? { outcome: 'rejected', reason: result.reason ?? null }
      : { outcome: result?.outcome ?? 'unknown' }
  } catch (error) {
    failure = error
  }
  // 성공했든 실패했든 원래 계정으로 돌아간다. 못 돌아가면 부르는 쪽이 알린다.
  const restored = switched
    ? await call('accounts.selectCodex', { accountId: original }).then(() => true, () => false)
    : true
  if (failure) {
    failure.restored = restored
    throw failure
  }
  return { ...outcome, restored }
}
