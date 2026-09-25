import { describe, expect, test } from 'bun:test'
import { Engine } from '../src/engine/engine.js'
import { claudeAccount, codexAccount, limits, makePorts } from './fakes.js'

const HOUR = 3_600_000
const T0 = Date.parse('2026-09-25T12:00:00Z')

function setup(options) {
  let clock = T0
  const now = () => clock
  const fake = makePorts({ now, ...options })
  const engine = new Engine(fake.ports, { now })
  return { engine, ...fake, advance: (ms) => { clock += ms }, now }
}

describe('재인증', () => {
  test('만료된 지 두 시간 된 토큰은 창 미리 열기가 꺼져 있어도 갱신한다', async () => {
    const { engine, calls, state } = setup({
      accounts: [claudeAccount('a', 1)],
      usage: { a: limits(T0) },
      expiry: { a: T0 - 2 * HOUR },
      policy: { keepAlive: false },
    })
    await engine.start({ schedule: false })
    await engine.cycle()
    expect(calls.refresh).toEqual(['a'])
    expect(state.log.some((entry) => entry.kind === 'token' && entry.text.startsWith('갱신함'))).toBe(true)
  })

  test('만료된 지 30분이면 Orca 몫으로 두고 갱신하지 않는다', async () => {
    const { engine, calls } = setup({
      accounts: [claudeAccount('a', 1)],
      usage: { a: limits(T0) },
      expiry: { a: T0 - 30 * 60_000 },
    })
    await engine.start({ schedule: false })
    await engine.cycle()
    expect(calls.refresh).toEqual([])
  })

  test('살아 있는 토큰은 만료 시각이 지나기 전까지 키체인을 다시 읽지 않는다', async () => {
    const { engine, calls, advance } = setup({
      accounts: [claudeAccount('a', 1)],
      usage: { a: limits(T0) },
      expiry: { a: T0 + 4 * HOUR },
    })
    await engine.start({ schedule: false })
    await engine.cycle()
    advance(2 * 60_000)
    await engine.cycle()
    expect(calls.peek).toEqual(['a'])
  })

  test('Codex 토큰은 건드리지 않는다', async () => {
    const { engine, calls } = setup({
      accounts: [codexAccount('x', 1)],
      usage: { x: limits(T0) },
    })
    await engine.start({ schedule: false })
    await engine.cycle()
    expect(calls.peek).toEqual([])
  })
})

describe('자동 전환', () => {
  const busy = { short: 95, weekly: 40 }
  const free = { short: 5, weekly: 20 }

  test('켜져 있고 활성이 임계를 넘으면 옮기고 알린다', async () => {
    const { engine, calls, state } = setup({
      accounts: [claudeAccount('a', 1, { active: true }), claudeAccount('b', 2)],
      usage: { a: limits(T0, busy), b: limits(T0, free) },
      active: { claude: 'a' },
      policy: { autoSwitch: true },
    })
    await engine.start({ schedule: false })
    await engine.cycle()
    expect(calls.select).toEqual([{ provider: 'claude', id: 'b' }])
    expect(calls.notify.map((entry) => entry.title)).toContain('계정 전환')
    expect(state.policy.lastSwitchAt).toBe(T0)
  })

  test('꺼져 있으면 판단만 하고 옮기지 않는다', async () => {
    const { engine, calls } = setup({
      accounts: [claudeAccount('a', 1, { active: true }), claudeAccount('b', 2)],
      usage: { a: limits(T0, busy), b: limits(T0, free) },
      active: { claude: 'a' },
    })
    await engine.start({ schedule: false })
    await engine.cycle()
    expect(calls.select).toEqual([])
    expect(engine.snapshot().decision.action).toBe('switch')
  })

  test('숨긴 계정으로는 옮기지 않는다', async () => {
    const { engine, calls } = setup({
      accounts: [claudeAccount('a', 1, { active: true }), claudeAccount('b', 2)],
      usage: { a: limits(T0, busy), b: limits(T0, free) },
      active: { claude: 'a' },
      policy: { autoSwitch: true, hiddenIds: ['b'] },
    })
    await engine.start({ schedule: false })
    await engine.cycle()
    expect(calls.select).toEqual([])
  })

  test('알림을 끄면 옮기되 알리지 않는다', async () => {
    const { engine, calls } = setup({
      accounts: [claudeAccount('a', 1, { active: true }), claudeAccount('b', 2)],
      usage: { a: limits(T0, busy), b: limits(T0, free) },
      active: { claude: 'a' },
      policy: { autoSwitch: true, notifications: false },
    })
    await engine.start({ schedule: false })
    await engine.cycle()
    expect(calls.select.length).toBe(1)
    expect(calls.notify).toEqual([])
  })
})

describe('요청', () => {
  test('범위 밖 판단 기준은 거절하고 범위 안은 저장한다', async () => {
    const { engine, state } = setup({ accounts: [claudeAccount('a', 1)] })
    await engine.start({ schedule: false })
    expect(() => engine.setTuning('switchAt', 200)).toThrow('사이입니다')
    engine.setTuning('switchAt', 70)
    expect(state.policy.tuning.switchAt).toBe(70)
    engine.resetTuning('switchAt')
    expect(state.policy.tuning.switchAt).toBeUndefined()
    expect(engine.snapshot().policy.tuning.switchAt).toBe(80)
  })

  test('모르는 정책과 참거짓 아닌 값은 거절한다', async () => {
    const { engine } = setup({ accounts: [] })
    await engine.start({ schedule: false })
    expect(() => engine.setPolicy({ nope: true })).toThrow('모르는 정책')
    expect(() => engine.setPolicy({ autoSwitch: 'yes' })).toThrow()
    expect(engine.setPolicy({ autoSwitch: true }).autoSwitch).toBe(true)
  })

  test('Orca 가 붙어 있고 토큰이 살아 있으면 손 갱신을 거절한다', async () => {
    const { engine, calls } = setup({
      accounts: [claudeAccount('a', 1)],
      usage: { a: limits(T0) },
      expiry: { a: T0 + HOUR },
    })
    await engine.start({ schedule: false })
    await engine.cycle()
    await expect(engine.refreshToken('a')).rejects.toThrow('Orca 가 토큰을 관리 중')
    expect(calls.refresh).toEqual([])
  })

  test('Codex 계정의 손 갱신은 거절한다', async () => {
    const { engine } = setup({ accounts: [codexAccount('x', 1)] })
    await engine.start({ schedule: false })
    await expect(engine.refreshToken('x')).rejects.toThrow('Codex')
  })

  test('이미 붙어 있는 계정으로는 옮기지 않는다', async () => {
    const { engine } = setup({
      accounts: [claudeAccount('a', 1, { active: true })],
      active: { claude: 'a' },
    })
    await engine.start({ schedule: false })
    await expect(engine.switchTo('a')).rejects.toThrow('이미')
  })

  test('조회 중에 들어온 재조회 여럿은 한 번으로 묶여 뒤따른다', async () => {
    const { engine, calls, state } = setup({ accounts: [claudeAccount('a', 1)], usage: { a: limits(T0) } })
    await engine.start({ schedule: false })
    state.fetchDelay = 20
    const first = engine.refresh()
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = engine.refresh()
    const third = engine.refresh()
    expect(second).toBe(third)
    await Promise.all([first, second, third])
    expect(calls.fetchLimits).toBe(2)
  })
})

describe('계정 목록', () => {
  test('Orca 가 꺼져 Codex 목록을 못 받으면 들고 있던 Codex 계정을 둔다', async () => {
    const accounts = [claudeAccount('a', 1), codexAccount('x', 2)]
    const { engine, state } = setup({ accounts })
    await engine.start({ schedule: false })
    state.accounts = [claudeAccount('a', 1)]
    state.codexKnown = false
    await engine.reloadAccounts()
    expect(engine.snapshot().accounts.map((row) => row.id)).toEqual(['a', 'x'])
    expect(state.log.filter((entry) => entry.text.includes('빠짐'))).toEqual([])
  })

  test('새 계정이 붙으면 기록에 남긴다', async () => {
    const { engine, state } = setup({ accounts: [claudeAccount('a', 1)] })
    await engine.start({ schedule: false })
    state.accounts = [claudeAccount('a', 1), codexAccount('x', 2)]
    await engine.reloadAccounts()
    expect(state.log.some((entry) => entry.text === '계정 합류: x@example.com')).toBe(true)
  })

  test('숨긴 계정은 상태에 hidden 으로 실린다', async () => {
    const { engine } = setup({ accounts: [claudeAccount('a', 1), claudeAccount('b', 2)] })
    await engine.start({ schedule: false })
    engine.setHidden('b', true)
    const rows = engine.snapshot().accounts
    expect(rows.find((row) => row.id === 'b').hidden).toBe(true)
    expect(rows.find((row) => row.id === 'a').hidden).toBe(false)
  })
})
