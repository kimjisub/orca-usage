import { describe, expect, test } from 'bun:test'
import {
  REFRESH_AFTER_EXPIRY_MS, isAbandoned, needsOpening, needsRelogin, refuseManualRefresh,
} from '../src/core/policy.js'

const NOW = Date.parse('2026-09-25T12:00:00Z')
const MINUTE = 60_000

describe('isAbandoned', () => {
  test('만료 시각을 모르면 아니다', () => expect(isAbandoned(null, NOW)).toBe(false))
  test('아직 살아 있으면 아니다', () => expect(isAbandoned(NOW + MINUTE, NOW)).toBe(false))
  test('만료된 지 30분이면 아니다', () => expect(isAbandoned(NOW - 30 * MINUTE, NOW)).toBe(false))
  test('만료된 지 정확히 한 시간이면 맞다', () => expect(isAbandoned(NOW - REFRESH_AFTER_EXPIRY_MS, NOW)).toBe(true))
  test('만료된 지 두 시간이면 맞다', () => expect(isAbandoned(NOW - 120 * MINUTE, NOW)).toBe(true))
})

describe('refuseManualRefresh', () => {
  const claude = { id: 'a', provider: 'claude' }
  test('계정이 없으면 거절한다', () => {
    expect(refuseManualRefresh(null, { orcaConnected: true, expiresAt: null, now: NOW })).toContain('고르세요')
  })
  test('Codex 는 거절한다', () => {
    expect(refuseManualRefresh({ provider: 'codex' }, { orcaConnected: false, now: NOW })).toContain('Codex')
  })
  test('Orca 가 꺼져 있으면 받는다', () => {
    expect(refuseManualRefresh(claude, { orcaConnected: false, expiresAt: NOW + MINUTE, now: NOW })).toBeNull()
  })
  test('Orca 가 붙어 있고 살아 있으면 거절한다', () => {
    expect(refuseManualRefresh(claude, { orcaConnected: true, expiresAt: NOW + MINUTE, now: NOW })).toContain('Orca')
  })
  test('Orca 가 붙어 있어도 버려진 토큰은 받는다', () => {
    expect(refuseManualRefresh(claude, { orcaConnected: true, expiresAt: NOW - 2 * 60 * MINUTE, now: NOW })).toBeNull()
  })
})

describe('needsOpening', () => {
  const open = (label, resetIn) => ({ label, pct: 10, resetsAt: new Date(NOW + resetIn).toISOString() })
  test('두 창이 다 돌고 있으면 열 것이 없다', () => {
    const row = { provider: 'claude', usage: { windows: [open('5h', MINUTE), open('7d', MINUTE)] } }
    expect(needsOpening(row, NOW)).toBe(false)
  })
  test('7d 만 닫혀 있어도 연다', () => {
    const row = { provider: 'claude', usage: { windows: [open('5h', MINUTE), open('7d', -MINUTE)] } }
    expect(needsOpening(row, NOW)).toBe(true)
  })
  test('자격증명이 끊긴 계정은 열지 않는다', () => {
    const row = { provider: 'claude', authFailed: true, usage: { windows: [] } }
    expect(needsOpening(row, NOW)).toBe(false)
  })
})

describe('needsRelogin', () => {
  const now = 1_000_000_000_000
  test('3일 안이면 필요, 그 밖이면 불필요, 모르면 불필요', () => {
    expect(needsRelogin({ refresh: { expiresAt: now + 2 * 86_400_000 } }, now)).toBe(true)
    expect(needsRelogin({ refresh: { expiresAt: now + 4 * 86_400_000 } }, now)).toBe(false)
    expect(needsRelogin({ refresh: { expiresAt: null } }, now)).toBe(false)
    expect(needsRelogin(null, now)).toBe(false)
  })
  test('폐기됐으면 기한과 무관하게 필요', () => {
    expect(needsRelogin({ refresh: { expiresAt: null, revokedAt: now } }, now)).toBe(true)
  })
})
