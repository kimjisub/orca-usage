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
    expect(state.log.some((entry) => entry.kind === 'token' && entry.text.startsWith('토큰 갱신'))).toBe(true)
  })

  test('액세스 토큰 만료가 늘면 갱신 시각을, 리프레시 토큰 지문이 바뀌면 교체 시각을 남긴다', async () => {
    const { engine, state, advance, now } = setup({
      accounts: [claudeAccount('a', 1)],
      usage: { a: limits(T0) },
      expiry: { a: T0 + 5 * HOUR },
    })
    await engine.start({ schedule: false })
    await engine.cycle()
    let token = engine.snapshot().accounts[0].token
    // 처음 읽은 값은 견줄 것이 없어 언제 바뀌었는지 모른다.
    expect(token.refresh).toEqual({ present: true, rotatedAt: null, revokedAt: null, expiresAt: null })
    expect(token.renewedAt).toBe(null)

    advance(10 * 60_000)
    state.expiry.a = now() + 8 * HOUR
    state.refresh.a = 'r-a-2'
    await engine.cycle()
    token = engine.snapshot().accounts[0].token
    expect(token.renewedAt).toBe(now())
    expect(token.refresh.rotatedAt).toBe(now())
  })

  test('키체인의 refresh token 만료를 상태에 싣는다', async () => {
    const { engine, state } = setup({ accounts: [claudeAccount('a', 1)], usage: { a: limits(T0) }, expiry: { a: T0 + HOUR } })
    state.refreshExpiry.a = T0 + 3 * 24 * HOUR
    await engine.start({ schedule: false })
    await engine.cycle()
    expect(engine.snapshot().accounts[0].token.refresh.expiresAt).toBe(T0 + 3 * 24 * HOUR)
  })

  test('refresh token 만료가 다가오면 단계마다 한 번씩 재로그인을 알린다', async () => {
    const { engine, state, calls, advance } = setup({ accounts: [claudeAccount('a', 1)], usage: { a: limits(T0) }, expiry: { a: T0 + HOUR } })
    state.refreshExpiry.a = T0 + 2 * 24 * HOUR
    await engine.start({ schedule: false })
    await engine.cycle()
    await engine.cycle()
    const warned = () => state.log.filter((entry) => entry.text.includes('재로그인 필요'))
    expect(warned()).toHaveLength(1)
    expect(warned()[0].text).toContain('3일 이내')
    expect(calls.notify.length).toBe(1)

    advance(30 * HOUR)
    await engine.cycle()
    expect(warned()).toHaveLength(2)
    expect(warned()[1].text).toContain('1일 이내')

    // 재로그인으로 기한이 30일 뒤로 바뀌면 조용하다.
    state.refreshExpiry.a = T0 + 32 * 24 * HOUR
    await engine.cycle()
    expect(warned()).toHaveLength(2)
  })

  test('발급처가 폐기했다고 답하면 폐기 시각을 남기고, 새 리프레시 토큰이 보이면 지운다', async () => {
    const { engine, ports, state, advance, now } = setup({
      accounts: [claudeAccount('a', 1)],
      usage: { a: limits(T0) },
      expiry: { a: T0 - 2 * HOUR },
    })
    ports.keychain.refresh = async () => ({
      refreshed: false, expiresAt: null, note: '리프레시 토큰 폐기됨', authFailed: true, revoked: true,
    })
    await engine.start({ schedule: false })
    await engine.cycle()
    expect(engine.snapshot().accounts[0].token.refresh.revokedAt).toBe(now())

    advance(10 * 60_000)
    state.refresh.a = 'r-a-relogin'
    state.expiry.a = now() + 8 * HOUR
    await engine.cycle()
    expect(engine.snapshot().accounts[0].token.refresh.revokedAt).toBe(null)
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

  test('살아 있는 토큰도 조회마다 만료 시각을 다시 읽고, 갱신은 하지 않는다', async () => {
    const { engine, calls, advance, state } = setup({
      accounts: [claudeAccount('a', 1)],
      usage: { a: limits(T0) },
      expiry: { a: T0 + 2 * 60_000 },
    })
    await engine.start({ schedule: false })
    // Orca 가 그 사이 갱신했다. 다음 조회에서 새 만료가 보여야 한다.
    state.expiry.a = T0 + 8 * HOUR
    advance(2 * 60_000)
    await engine.cycle()
    expect(calls.refresh).toEqual([])
    expect(engine.snapshot().accounts[0].token.expiresAt).toBe(T0 + 8 * HOUR)
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
    expect(() => engine.setTuning('switchAt', 200)).toThrow('사이만 됩니다')
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
    expect(state.log.filter((entry) => entry.text.startsWith('계정 이탈'))).toEqual([])
  })

  test('목록을 못 읽으면 들고 있던 계정을 두고 이유를 기록에 남긴다', async () => {
    const { engine, ports, state } = setup({ accounts: [claudeAccount('a', 1)] })
    await engine.start({ schedule: false })
    ports.orca.listAccounts = async () => { throw new Error('소켓 없음') }
    await engine.reloadAccounts()
    expect(engine.snapshot().accounts.map((row) => row.id)).toEqual(['a'])
    expect(state.log.some((entry) => entry.text === '계정 목록 조회 실패: 소켓 없음')).toBe(true)
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

describe('상세', () => {
  test('살아 있는 Claude 토큰은 Orca 몫이고 만료와 확인 시각이 실린다', async () => {
    const { engine } = setup({ accounts: [claudeAccount('a', 1)], usage: { a: limits(T0) }, expiry: { a: T0 + HOUR } })
    await engine.start({ schedule: false })
    const token = engine.snapshot().accounts[0].token
    expect(token).toMatchObject({ expiresAt: T0 + HOUR, checkedAt: T0, owner: 'orca', source: 'keychain' })
  })

  test('시스템 기본 Codex 로그인으로는 옮기지 않는다', async () => {
    const system = { ...codexAccount('codex-system:x', 1), system: true }
    const { engine } = setup({ accounts: [system, codexAccount('y', 2)], active: { codex: 'y' } })
    await engine.start({ schedule: false })
    await expect(engine.switchTo('codex-system:x')).rejects.toThrow('Orca 앱에서')
  })
})


describe('리셋', () => {
  const grant = (left) => ({
    grants: { eligible: true, reason: null, atLimit: false, list: [{ id: 'g1', label: 'launch', resetsLeft: left, resetsTotal: 1, clears: ['five_hour', 'seven_day'], usableNow: left > 0, useRequiresLimit: false, paused: false, startsAt: null, endsAt: null }] },
    session: { eligible: false, reason: 'not_at_wall', available: false, nextAvailableAt: null, perWeek: 1 },
  })

  test('Claude 리셋 상태를 30분에 한 번 읽어 상태에 싣는다', async () => {
    const { engine, state, calls, advance } = setup({ accounts: [claudeAccount('a', 1)], usage: { a: limits(T0) } })
    state.resets.a = { status: grant(1), error: null }
    await engine.start({ schedule: false })
    await engine.cycle()
    await engine.cycle()
    expect(calls.resetStatus).toEqual(['a'])
    expect(engine.snapshot().accounts[0].resets.grants.list[0].resetsLeft).toBe(1)
    advance(31 * 60_000)
    await engine.cycle()
    expect(calls.resetStatus).toEqual(['a', 'a'])
  })

  test('5h 가 한도에 닿은 계정은 조회마다 읽는다. 세션 리셋은 그때 열린다', async () => {
    const { engine, calls } = setup({ accounts: [claudeAccount('a', 1)], usage: { a: limits(T0, { short: 100 }) } })
    await engine.start({ schedule: false })
    await engine.cycle()
    await engine.cycle()
    expect(calls.resetStatus).toEqual(['a', 'a'])
  })

  test('못 읽으면 들고 있던 상태를 둔다', async () => {
    const { engine, state, advance } = setup({ accounts: [claudeAccount('a', 1)], usage: { a: limits(T0) } })
    state.resets.a = { status: grant(1), error: null }
    await engine.start({ schedule: false })
    await engine.cycle()
    state.resets.a = { status: null, error: '호출 예산 소진' }
    advance(31 * 60_000)
    await engine.cycle()
    const resets = engine.snapshot().accounts[0].resets
    expect(resets.grants.list[0].resetsLeft).toBe(1)
    expect(resets.error).toBe('호출 예산 소진')
  })

  test('Claude 계정의 리셋은 쓰지 않고 Claude Code 로 안내한다', async () => {
    const { engine, calls } = setup({ accounts: [claudeAccount('a', 1)], usage: { a: limits(T0) } })
    await engine.start({ schedule: false })
    await expect(engine.useResetCredit('a')).rejects.toThrow('/usage-credits')
    expect(calls.consume).toEqual([])
  })

  test('크레딧이 없는 Codex 계정은 Orca 를 부르지 않는다', async () => {
    const { engine, calls } = setup({ accounts: [codexAccount('x', 1)], usage: { x: limits(T0) } })
    await engine.start({ schedule: false })
    await engine.cycle()
    await expect(engine.useResetCredit('x')).rejects.toThrow('크레딧이 없습니다')
    expect(calls.consume).toEqual([])
  })

  test('Codex 크레딧을 쓰면 결과를 기록하고, 원래 계정으로 못 돌아가면 알린다', async () => {
    const { engine, state, calls } = setup({ accounts: [codexAccount('x', 1)], usage: { x: { ...limits(T0), credits: { available: 2, nextExpiresAt: null } } } })
    await engine.start({ schedule: false })
    await engine.cycle()
    const done = await engine.useResetCredit('x')
    expect(calls.consume).toEqual(['x'])
    expect(done.outcome).toBe('reset')
    expect(state.log.some((entry) => entry.kind === 'reset' && entry.text.startsWith('리셋 크레딧 사용'))).toBe(true)

    state.consumeResult = { outcome: 'reset', restored: false }
    await engine.useResetCredit('x')
    expect(state.log.some((entry) => entry.text.includes('원래 Codex 계정으로 못 돌아감'))).toBe(true)
    expect(calls.notify.some((entry) => JSON.stringify(entry).includes('계정 확인 필요'))).toBe(true)
  })
})
