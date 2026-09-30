import { describe, expect, test } from 'bun:test'
import { parseResetStatus } from '../src/adapters/keychain/resets.js'
import { expectedScope, offerRevision } from '../src/adapters/orca/codex-reset.js'

// 2026-09-30 에 Claude Code User-Agent 로 받은 응답의 모양(값은 줄임).
const CLAUDE = {
  juniper_tide: { eligible: false, ineligible_reason: 'not_at_wall', in_experiment: false, arm: null, available: false, next_available_at: null, weekly_resets_at: null, resets_per_week: 1, event_props: null },
  cedar_ember: {
    eligible: true, ineligible_reason: null, at_limit: false, exhausted: [],
    grants: [{ id: 'opus55-launch-promax-20260921', label: 'Claude Opus 5.5 launch: one usage-limit reset for Pro and Max', resets_total: 1, resets_left: 1, starts_at: '2026-09-22T16:00:00+00:00', ends_at: '2026-10-22T16:00:00+00:00', clears: ['five_hour', 'seven_day', 'seven_day_overage_included'], paused: false, usable_now: true, use_requires_limit: false, percent_used: {}, blocking: [], arm: null }],
    next_grant_id: 'opus55-launch-promax-20260921', weekly_resets_at: '2026-10-05T17:00:00+00:00', cooldown_until: null, event_props: null,
  },
}

describe('Claude 리셋 상태', () => {
  test('리셋권과 세션 리셋을 꺼낸다', () => {
    const status = parseResetStatus(CLAUDE)
    expect(status.grants.eligible).toBe(true)
    expect(status.grants.list).toEqual([{
      id: 'opus55-launch-promax-20260921',
      label: 'Claude Opus 5.5 launch: one usage-limit reset for Pro and Max',
      resetsLeft: 1, resetsTotal: 1,
      startsAt: Date.parse('2026-09-22T16:00:00+00:00'), endsAt: Date.parse('2026-10-22T16:00:00+00:00'),
      clears: ['five_hour', 'seven_day', 'seven_day_overage_included'],
      paused: false, usableNow: true, useRequiresLimit: false,
    }])
    expect(status.session).toEqual({ eligible: false, reason: 'not_at_wall', available: false, nextAvailableAt: null, perWeek: 1 })
  })

  test('Claude Code 가 아니라고 거절된 응답은 권 없이 사유만 남는다', () => {
    const status = parseResetStatus({ cedar_ember: { eligible: false, ineligible_reason: 'surface', grants: [] }, juniper_tide: null })
    expect(status.grants).toEqual({ eligible: false, reason: 'surface', atLimit: false, list: [] })
    expect(status.session).toBeNull()
  })
})

// Orca 1.4.204 의 accounts.list 에서 받은 활성 Codex 한도의 모양.
const LIMITS = {
  provider: 'codex',
  session: null,
  weekly: { usedPercent: 5, windowMinutes: 10080, resetsAt: 1791050425000, resetDescription: 'Sun 3:00 AM' },
  rateLimitResetCredits: {
    availableCount: 2, totalEarnedCount: 0, nextExpiresAt: 1792700904445,
    credits: [
      { status: 'available', expiresAt: 1792800000000, grantedAt: 1790000000000 },
      { status: 'available', expiresAt: 1792700904445, grantedAt: 1789000000000 },
    ],
  },
  updatedAt: 1790732952375,
  error: null,
  status: 'ok',
}

describe('Codex 리셋 크레딧 범위', () => {
  test('제안 지문은 Orca 의 Gaa 와 같은 식이다', () => {
    // Orca 원문: `v1:${JSON.stringify([count, earned, nextExpiresAt, 정렬한 [status, expiresAt, grantedAt], Waa(session), Waa(weekly), updatedAt])}`
    expect(offerRevision(LIMITS)).toBe('v1:' + JSON.stringify([
      2, 0, 1792700904445,
      [['available', 1792700904445, 1789000000000], ['available', 1792800000000, 1790000000000]],
      null, [5, 10080, 1791050425000], 1790732952375,
    ]))
  })

  test('고른 계정과 한도로 범위를 만든다', () => {
    const payload = { codex: { accounts: [{ id: 'a', managedHomeRuntime: 'host', updatedAt: 42 }] }, rateLimits: { codex: LIMITS } }
    expect(expectedScope(payload, 'a')).toEqual({
      target: { runtime: 'host', wslDistro: null }, accountId: 'a', accountRevision: 42, offerRevision: offerRevision(LIMITS),
    })
  })

  test('크레딧이 없거나 계정이 없으면 범위를 만들지 않는다', () => {
    const none = { ...LIMITS, rateLimitResetCredits: { ...LIMITS.rateLimitResetCredits, availableCount: 0 } }
    expect(expectedScope({ codex: { accounts: [{ id: 'a', updatedAt: 1 }] }, rateLimits: { codex: none } }, 'a')).toBeNull()
    expect(expectedScope({ codex: { accounts: [] }, rateLimits: { codex: LIMITS } }, 'a')).toBeNull()
  })
})
