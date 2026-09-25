import { EventEmitter } from 'node:events'
import { advise, scoreAccounts } from '../core/advice.js'
import { decideSwitch } from '../core/autoswitch.js'
import { isAbandoned, needsOpening, refuseManualRefresh } from '../core/policy.js'
import { TUNABLES, TUNING_DEFAULTS, applyTuning, formatTuning, tuning } from '../core/tuning.js'
import { pollOnce, rowsFromCache } from './poller.js'

// Orca 에서 손으로 계정을 바꾸면 이만큼 안에 화면에 뜬다. 소켓 한 번이라 가볍다.
const ACTIVE_POLL_MS = 5_000
// 추천과 점수는 시각에 따라 변한다(창이 흐른 비율). 조회가 없어도 이만큼마다 다시 잰다.
const DERIVE_MS = 60_000
const UPDATE_CHECK_MS = 6 * 60 * 60_000
// 갱신에 실패한 토큰은 이만큼 다시 건드리지 않는다. 폐기된 refresh token 으로
// 조회 주기마다 토큰 엔드포인트를 두드리면 아무것도 나아지지 않고 요청만 쌓인다.
const REFRESH_RETRY_MS = 30 * 60_000

const POLICY_SWITCHES = ['autoSwitch', 'keepAlive', 'notifications']

/**
 * 백엔드의 본체. 모든 상태의 정본이다.
 *
 * 조회 주기마다 계정 목록을 다시 읽고, 사용량을 받고, 버려진 토큰을 갱신하고,
 * 정책이 켜져 있으면 창을 열고 계정을 옮긴다. 사람의 요청(즉시 조회, 전환,
 * 정책 변경)도 여기서 처리한다. 상태가 바뀔 때마다 'state', 기록이 한 줄 늘
 * 때마다 'log' 를 낸다.
 *
 * 바깥과는 ports 로만 말한다(engine/ports.js). 그래서 테스트는 가짜를 넣어
 * 실제 계정 없이 정책을 돌린다.
 */
export class Engine extends EventEmitter {
  /**
   * @param {import('./ports.js').Ports} ports
   * @param {{now?: () => number, meta?: object}} [options]
   *   meta 는 상태의 daemon 칸에 그대로 실린다(버전, pid, 누가 띄웠는지)
   */
  constructor(ports, { now = () => Date.now(), meta = {} } = {}) {
    super()
    this.ports = ports
    this.now = now
    this.meta = { pid: process.pid, startedAt: now(), ...meta }
    this.policy = ports.store.loadPolicy()
    // 기준은 모듈 전역이다. 기본값에서 다시 세워야 앞서 쓰던 값이 남지 않는다.
    applyTuning({ ...TUNING_DEFAULTS, ...this.policy.tuning })

    this.accounts = []
    this.rows = []
    this.active = { claude: null, codex: null }
    this.orcaState = { connected: false, lastError: null, checkedAt: null }
    this.pollState = { running: false, lastAt: null, ok: null, error: null, nextAt: null }
    this.advice = null
    this.scores = []
    this.decision = null
    this.updateInfo = null
    this.historyAt = 0

    this.timers = {}
    this.scheduling = false
    this.current = null
    this.pending = null
    this.pendingForce = false
    this.switching = false
    this.publishQueued = false

    // 같은 것을 두 번 적지 않으려고 마지막으로 본 것을 들고 있는다.
    this.knownIds = null
    this.lastShape = ''
    this.authSeen = new Set()
    this.refreshSeen = new Map()
    // 계정별 토큰 만료 시각. 아직 살아 있으면 키체인을 다시 읽지 않는다.
    this.expiry = new Map()
    this.refreshFailedAt = new Map()
  }

  /**
   * 켠다. 캐시로 첫 상태를 세우고, schedule 이면 주기 일을 건다.
   * 테스트는 schedule 을 끄고 cycle 을 직접 부른다.
   */
  async start({ schedule = true } = {}) {
    await this.reloadAccounts()
    const cache = this.ports.store.loadCache()
    for (const [id, entry] of Object.entries(cache)) {
      if (typeof entry?.expiresAt === 'number') this.expiry.set(id, entry.expiresAt)
      if (entry?.refreshedAt) this.refreshSeen.set(id, entry.refreshedAt)
    }
    // 켜기 전부터 끊겨 있던 계정은 이미 알렸던 것이다. 켤 때마다 다시 알리지 않는다.
    for (const row of this.rows) if (row.authFailed) this.authSeen.add(row.id)
    const claude = this.accounts.find((account) => account.provider === 'claude' && account.active)
    this.active = { claude: claude?.id ?? null, codex: null }
    this.derive()
    this.publish()
    if (!schedule) return

    this.scheduling = true
    this.runPoll()
    this.trackActive()
    this.timers.active = setInterval(() => this.trackActive(), ACTIVE_POLL_MS)
    this.timers.derive = setInterval(() => {
      this.derive()
      this.publish()
    }, DERIVE_MS)
    if (this.ports.updater) {
      this.checkUpdate().catch(() => {})
      this.timers.update = setInterval(() => this.checkUpdate().catch(() => {}), UPDATE_CHECK_MS)
    }
  }

  stop() {
    this.scheduling = false
    clearTimeout(this.timers.poll)
    clearInterval(this.timers.active)
    clearInterval(this.timers.derive)
    clearInterval(this.timers.update)
  }

  // ---- 조회 -------------------------------------------------------------

  /**
   * 조회를 한 바퀴 돌린다. 조회는 한 번에 하나만 돈다.
   *
   * 돌고 있는 중에 들어온 요청은 그것이 끝난 뒤 한 번 더 돌고, 그 결과로 답한다.
   * 그 사이 여러 번 들어와도 한 번으로 묶는다. 사용량 엔드포인트가 계정당 5분에
   * 5회라, 누른 만큼 다 돌면 예산을 태운다.
   */
  runPoll({ force = false } = {}) {
    if (this.pending) {
      this.pendingForce = this.pendingForce || force
      return this.pending
    }
    this.pendingForce = force
    const previous = this.current ?? Promise.resolve()
    const run = previous.catch(() => {}).then(() => {
      this.pending = null
      this.current = run
      const forced = this.pendingForce
      this.pendingForce = false
      return this.cycle({ force: forced })
    }).finally(() => {
      if (this.current === run) this.current = null
      this.scheduleNext()
    })
    this.pending = run
    return run
  }

  scheduleNext() {
    if (!this.scheduling) return
    clearTimeout(this.timers.poll)
    const interval = tuning().intervalMs
    this.pollState.nextAt = this.now() + interval
    this.timers.poll = setTimeout(() => this.runPoll(), interval)
    this.publish()
  }

  /** 조회 한 바퀴. 목록, 사용량, 재인증, 창 열기, 자동 전환 순서다. */
  async cycle({ force = false } = {}) {
    this.pollState.running = true
    this.publish()
    try {
      await this.reloadAccounts()
      const fresh = await pollOnce(this.accounts, {
        force,
        allowRefresh: true,
        freshForMs: tuning().intervalMs * 0.9,
        onOrca: ({ ok, error }) => this.setOrca(ok, error),
      }, this.ports)
      this.mergeRows(fresh)
      this.noteShape(fresh)
      this.noteTokens(fresh)
      this.noteAuth(fresh)
      await this.reauth()
      if (this.policy.keepAlive) await this.openWindows()
      this.derive()
      if (this.policy.autoSwitch) await this.autoSwitch()
      this.pollState.ok = true
      this.pollState.error = null
    } catch (error) {
      this.note('error', `조회 실패: ${error.message}`, { ok: false })
      this.pollState.ok = false
      this.pollState.error = error.message
    } finally {
      this.pollState.running = false
      this.pollState.lastAt = this.now()
      this.derive()
      this.publish()
    }
    return { ok: this.pollState.ok, error: this.pollState.error, accounts: this.rows.length }
  }

  /**
   * 계정 목록을 다시 세운다. Orca 에서 계정을 더하거나 뺀 것이 여기서 반영된다.
   * 목록을 못 읽으면 들고 있던 것을 그대로 쓴다.
   */
  async reloadAccounts() {
    let listed
    try {
      listed = await this.ports.orca.listAccounts()
    } catch {
      return this.accounts
    }
    let all = listed.accounts
    if (!listed.codexKnown) {
      // Orca 가 꺼져 Codex 목록을 못 받았다. 없어진 것이 아니므로 들고 있던 것을 둔다.
      const codex = this.accounts.filter((account) => account.provider === 'codex')
      all = [...all.filter((account) => account.provider !== 'codex'), ...codex]
        .map((account, index) => ({ ...account, index: index + 1 }))
    }

    const ids = new Set(all.map((account) => account.id))
    if (this.knownIds) {
      const added = all.filter((account) => !this.knownIds.has(account.id))
      const gone = [...this.knownIds].filter((id) => !ids.has(id))
      if (added.length) this.note('poll', `계정 합류: ${added.map((account) => account.email).join(', ')}`)
      if (gone.length) this.note('poll', `계정 ${gone.length}개가 목록에서 빠짐`)
    }
    this.knownIds = ids
    this.accounts = all

    // 들고 있던 값은 지우지 않는다. 새로 합류한 계정만 캐시에서 온다.
    const known = new Map(this.rows.map((row) => [row.id, row]))
    this.rows = rowsFromCache(all, this.ports.store).map((row) => ({
      ...row,
      ...known.get(row.id),
      index: row.index,
      provider: row.provider,
      email: row.email,
      label: row.label,
    }))
    return all
  }

  mergeRows(fresh) {
    const byId = new Map(fresh.map((row) => [row.id, row]))
    this.rows = this.rows.map((row) => {
      const next = byId.get(row.id)
      return next ? { ...next, index: row.index, label: row.label } : row
    })
  }

  /** 조회는 2분마다 돈다. 결과의 모양이 달라졌을 때만 적는다. */
  noteShape(fresh) {
    const shape = fresh.map((row) => `${row.id}:${row.source}:${row.note ?? ''}`).join('|')
    if (shape === this.lastShape) return
    this.lastShape = shape
    const viaOrca = fresh.filter((row) => row.source === 'orca').length
    const how = viaOrca === fresh.length ? 'Orca' : `Orca ${viaOrca}, 직접 ${fresh.length - viaOrca}`
    this.note('poll', `${fresh.length} 계정, ${how}`)
  }

  /** Orca 가 꺼져 직접 조회하는 동안 그 경로가 갱신한 토큰을 적는다. */
  noteTokens(fresh) {
    for (const row of fresh) {
      if (!row.refreshedAt || row.refreshedAt <= (this.refreshSeen.get(row.id) ?? 0)) continue
      this.refreshSeen.set(row.id, row.refreshedAt)
      if (typeof row.expiresAt === 'number') this.expiry.set(row.id, row.expiresAt)
      this.note('token', '갱신함', { email: row.email })
    }
  }

  /**
   * 다시 로그인해야 풀리는 계정을 새로 발견하면 알린다. 기다린다고 낫지 않으므로
   * 사람이 알아야 한다. 같은 계정은 회복될 때까지 한 번만 알린다.
   */
  noteAuth(fresh) {
    for (const row of fresh) {
      if (row.authFailed && !this.authSeen.has(row.id)) {
        this.authSeen.add(row.id)
        const reason = row.note ?? '자격증명 실패'
        this.note('error', reason, { email: row.email, ok: false })
        this.alert('재로그인 필요', `${row.email}: ${reason}`)
      } else if (!row.authFailed) {
        this.authSeen.delete(row.id)
      }
    }
  }

  /**
   * Orca 가 손을 놓은 Claude 토큰을 갱신한다. 정책과 무관하게 늘 돈다.
   *
   * 살아 있는 토큰은 Orca 의 몫이라 만료 시각이 지나기 전에는 키체인도 읽지
   * 않는다. Orca 가 그 사이 갱신했으면 만료 시각이 지난 뒤 한 번 읽어 새 시각을
   * 알게 된다. 만료된 지 한 시간이 넘은 것만 우리가 갱신한다(core/policy.js).
   */
  async reauth() {
    const { keychain, store } = this.ports
    for (const account of this.accounts) {
      if (account.provider !== 'claude') continue
      const now = this.now()
      const known = this.expiry.get(account.id)
      if (typeof known === 'number' && known > now) continue
      if (now - (this.refreshFailedAt.get(account.id) ?? 0) < REFRESH_RETRY_MS) continue

      let expiresAt
      try {
        expiresAt = await keychain.peekExpiry(account.id)
      } catch {
        continue // 키체인이 잠깐 잠겼다. 다음 조회에 다시 본다
      }
      this.expiry.set(account.id, expiresAt)
      if (!isAbandoned(expiresAt, now)) continue

      let result
      try {
        result = await keychain.refresh(account.id)
      } catch (error) {
        this.refreshFailedAt.set(account.id, now)
        this.note('error', `토큰 갱신 실패: ${error.message}`, { email: account.email, ok: false })
        continue
      }
      if (result.refreshed) {
        this.refreshFailedAt.delete(account.id)
        this.expiry.set(account.id, result.expiresAt)
        store.updateCache(account.id, { expiresAt: result.expiresAt, refreshedAt: now })
        this.refreshSeen.set(account.id, now)
        const hours = Math.floor((now - expiresAt) / 3_600_000)
        this.note('token', `갱신함 (만료 ${hours}시간 지남)`, { email: account.email })
        continue
      }
      this.refreshFailedAt.set(account.id, now)
      this.note('error', `토큰 갱신 실패: ${result.note ?? '이유 모름'}`, { email: account.email, ok: false })
      if (result.authFailed) {
        this.rows = this.rows.map((row) => (row.id === account.id
          ? { ...row, authFailed: true, note: result.note ?? row.note }
          : row))
        this.noteAuth(this.rows.filter((row) => row.id === account.id))
      }
    }
  }

  /** 닫힌 5h 나 7d 창을 요청 하나로 연다. keepAlive 정책이 켜져 있을 때만 돈다. */
  async openWindows() {
    const { keychain, store } = this.ports
    const log = store.loadLog()
    for (const row of this.rows) {
      const now = this.now()
      if (!needsOpening(row, now)) continue
      // 쿨다운은 기록에서 읽는다. 메모리로만 들면 백엔드를 다시 띄울 때마다
      // 초기화돼 창이 이미 열렸는데도 요청을 또 보낸다.
      const lastAt = log.find((entry) => entry.kind === 'cycle' && entry.email === row.email)?.at ?? 0
      if (now - lastAt < tuning().openCooldownMs) continue
      const result = await keychain.openWindow(row.id)
      if (result.refreshed) this.note('token', '창 열기 전에 갱신함', { email: row.email })
      this.note('cycle', result.ok ? '창 열음' : `창 못 열음: ${result.reason}`,
        { email: row.email, ok: result.ok })
    }
  }

  /** 추천과 점수, 전환 판단을 지금 상태로 다시 잰다. 숨긴 계정은 빠진다. */
  derive() {
    const now = this.now()
    const hidden = new Set(this.policy.hiddenIds)
    const claude = this.viewRows().filter((row) => row.provider === 'claude' && !hidden.has(row.id))
    const history = this.ports.store.loadHistory()
    this.advice = advise(claude, history, now)
    this.scores = scoreAccounts(claude, history, now).filter((entry) => entry.hasData)
    this.decision = decideSwitch(claude, this.advice, {
      activeId: this.active.claude,
      lastSwitchAt: this.policy.lastSwitchAt,
      now,
    })
    let latest = 0
    for (const series of Object.values(history)) latest = Math.max(latest, series.at(-1)?.at ?? 0)
    this.historyAt = latest
  }

  /**
   * 판단이 옮기라고 하면 옮긴다. 이미 떠 있는 터미널은 옛 계정으로 계속 돌고,
   * 바뀐 계정은 그다음에 여는 세션부터 적용되므로 사람이 알아야 한다.
   */
  async autoSwitch() {
    const verdict = this.decision
    if (verdict?.action !== 'switch' || this.switching) return
    this.switching = true
    try {
      await this.ports.orca.select('claude', verdict.target.id)
      this.active = { ...this.active, claude: verdict.target.id }
      this.policy.lastSwitchAt = this.now()
      this.savePolicy()
      this.note('switch', `자동[${verdict.why}] ${verdict.reason}`, { email: verdict.target.email })
      this.alert('계정 전환', `${verdict.target.email} 로 옮겼습니다 (${verdict.why}). 새 세션부터 적용됩니다`)
    } catch (error) {
      this.note('error', `자동 전환 실패: ${error.message}`, { email: verdict.target.email, ok: false })
      this.alert('자동 전환 실패', error.message)
    } finally {
      this.switching = false
    }
  }

  /** Orca 가 지금 붙어 있는 계정을 따라간다. 손으로 바꾼 것도 여기서 잡힌다. */
  async trackActive() {
    if (this.activePending) return
    this.activePending = true
    try {
      const ids = await this.ports.orca.activeIds()
      this.setOrca(true, null)
      if (ids.claude !== this.active.claude || ids.codex !== this.active.codex) {
        this.active = { claude: ids.claude ?? null, codex: ids.codex ?? null }
        this.derive()
        this.publish()
      }
    } catch (error) {
      this.setOrca(false, error.message)
    } finally {
      this.activePending = false
    }
  }

  setOrca(connected, error) {
    const changed = this.orcaState.connected !== connected
    this.orcaState = { connected, lastError: connected ? null : error, checkedAt: this.now() }
    if (changed) this.publish()
  }

  // ---- 요청 -------------------------------------------------------------

  /** 지금 조회한다(r). 돌고 있으면 그것이 끝난 뒤 한 번 더 돈다. */
  refresh() {
    return this.runPoll({ force: true })
  }

  /** 한 계정의 토큰을 손으로 갱신한다(t). 받을지는 core/policy.js 가 정한다. */
  async refreshToken(accountId) {
    const { keychain, store } = this.ports
    const account = this.accounts.find((entry) => entry.id === accountId)
    let expiresAt = null
    if (account?.provider === 'claude' && this.orcaState.connected) {
      try {
        expiresAt = await keychain.peekExpiry(accountId)
      } catch (error) {
        throw new Error(`자격증명을 읽지 못했습니다: ${error.message}`)
      }
    }
    const refusal = refuseManualRefresh(account, {
      orcaConnected: this.orcaState.connected, expiresAt, now: this.now(),
    })
    if (refusal) throw new Error(refusal)

    const result = await keychain.refresh(accountId)
    if (!result.refreshed) throw new Error(result.note ?? '갱신하지 못했습니다')
    const now = this.now()
    this.refreshFailedAt.delete(accountId)
    this.expiry.set(accountId, result.expiresAt)
    this.refreshSeen.set(accountId, now)
    store.updateCache(accountId, { expiresAt: result.expiresAt, refreshedAt: now })
    this.note('token', '손으로 갱신함', { email: account.email })
    this.runPoll({ force: true })
    return { email: account.email, expiresAt: result.expiresAt }
  }

  /** 고른 계정으로 Orca 를 옮긴다(Enter). */
  async switchTo(accountId) {
    const account = this.accounts.find((entry) => entry.id === accountId)
    if (!account) throw new Error('없는 계정입니다')
    if (this.active[account.provider] === accountId) throw new Error('이미 이 계정에 붙어 있습니다')
    if (this.switching) throw new Error('다른 전환이 진행 중입니다')
    this.switching = true
    try {
      await this.ports.orca.select(account.provider, accountId)
      this.active = { ...this.active, [account.provider]: accountId }
      // 손으로 옮긴 것도 쿨다운에 넣는다. 안 그러면 자동 전환이 곧바로 되돌린다.
      // 자동 전환은 Claude 사이에서만 돌므로 Codex 를 옮긴 것은 넣지 않는다.
      if (account.provider === 'claude') {
        this.policy.lastSwitchAt = this.now()
        this.savePolicy()
      }
      this.note('switch', '수동 전환', { email: account.email })
    } catch (error) {
      this.note('error', `수동 전환 실패: ${error.message}`, { email: account.email, ok: false })
      throw error
    } finally {
      this.switching = false
    }
    this.derive()
    this.publish()
    this.runPoll({ force: true })
    return { email: account.email }
  }

  /** 자동 전환, 창 미리 열기, 알림을 켜고 끈다(a, o, 설정). 보낸 것만 바꾼다. */
  setPolicy(patch) {
    const entries = Object.entries(patch ?? {})
    for (const [key, value] of entries) {
      if (!POLICY_SWITCHES.includes(key)) throw new Error(`모르는 정책입니다: ${key}`)
      if (typeof value !== 'boolean') throw new Error(`${key}: 켜기나 끄기만 받습니다`)
    }
    for (const [key, value] of entries) this.policy[key] = value
    this.savePolicy()
    this.derive()
    this.publish()
    return this.policyView()
  }

  /** 판단 기준 하나를 바꾼다. 범위 밖이면 거절한다. */
  setTuning(key, value) {
    const item = TUNABLES.find((entry) => entry.key === key)
    if (!item) throw new Error(`모르는 설정입니다: ${key}`)
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${item.label}: 숫자만 됩니다`)
    if (value < item.min || value > item.max) {
      throw new Error(`${item.label}: ${formatTuning(item, item.min)}~${formatTuning(item, item.max)} 사이만 됩니다`)
    }
    this.policy.tuning = { ...this.policy.tuning, [key]: value }
    return this.afterTuning(key)
  }

  /** 판단 기준 하나를 기본값으로 되돌린다. */
  resetTuning(key) {
    if (!TUNABLES.some((entry) => entry.key === key)) throw new Error(`모르는 설정입니다: ${key}`)
    const { [key]: _dropped, ...rest } = this.policy.tuning
    this.policy.tuning = rest
    return this.afterTuning(key)
  }

  afterTuning(key) {
    applyTuning({ ...TUNING_DEFAULTS, ...this.policy.tuning })
    this.savePolicy()
    // 조회 주기를 바꿨으면 다음 조회 시각도 새 주기로 다시 잡는다.
    if (key === 'intervalMs' && !this.current) this.scheduleNext()
    this.derive()
    this.publish()
    return { ...tuning() }
  }

  /** 계정 하나를 숨기거나 되돌린다(x). 숨긴 계정은 합계와 추천, 자동 전환에서 빠진다. */
  setHidden(accountId, hidden) {
    if (typeof accountId !== 'string') throw new Error('계정 id 가 필요합니다')
    const ids = new Set(this.policy.hiddenIds)
    if (hidden) ids.add(accountId)
    else ids.delete(accountId)
    this.policy.hiddenIds = [...ids]
    this.savePolicy()
    this.derive()
    this.publish()
    return this.policyView()
  }

  async checkUpdate() {
    if (!this.ports.updater) return null
    const result = await this.ports.updater.check()
    this.updateInfo = { ...result, checkedAt: this.now() }
    this.publish()
    return this.updateInfo
  }

  /**
   * 최신으로 받는다. 받은 것이 있으면 'restart' 를 낸다. 다시 뜨는 방법은 누가
   * 백엔드를 띄웠느냐에 달려 있어 daemon 쪽이 정한다.
   */
  async update() {
    if (!this.ports.updater) throw new Error('이 설치에서는 업데이트를 할 수 없습니다')
    const result = await this.ports.updater.apply()
    if (result.changed) {
      this.note('poll', `업데이트 ${result.from ?? '?'} -> ${result.to ?? '?'}, 다시 뜹니다`)
      this.emit('restart', result)
    } else {
      this.updateInfo = { ...(this.updateInfo ?? {}), available: false, checkedAt: this.now() }
      this.publish()
    }
    return result
  }

  // ---- 읽기 -------------------------------------------------------------

  viewRows() {
    return this.rows.map((row) => ({ ...row, active: row.id === this.active[row.provider] }))
  }

  policyView() {
    const { autoSwitch, keepAlive, notifications, hiddenIds } = this.policy
    return { autoSwitch, keepAlive, notifications, hiddenIds: [...hiddenIds], tuning: { ...tuning() } }
  }

  snapshot() {
    const hidden = new Set(this.policy.hiddenIds)
    return {
      daemon: { ...this.meta },
      orca: { ...this.orcaState },
      poll: { ...this.pollState, intervalMs: tuning().intervalMs },
      accounts: this.viewRows().map((row) => ({ ...row, hidden: hidden.has(row.id) })),
      active: { ...this.active },
      policy: this.policyView(),
      advice: this.advice,
      scores: this.scores,
      decision: this.decision,
      update: this.updateInfo,
      lastSwitchAt: this.policy.lastSwitchAt,
      historyAt: this.historyAt,
    }
  }

  /** since 이후의 표본만. 화면은 처음에 0 으로 전부 받고 그 뒤로는 늘어난 것만 받는다. */
  history(since = 0) {
    const out = {}
    for (const [id, series] of Object.entries(this.ports.store.loadHistory())) {
      const kept = series.filter((point) => point.at > since)
      if (kept.length) out[id] = kept
    }
    return out
  }

  /** 최신이 앞이다. */
  log() {
    return this.ports.store.loadLog()
  }

  // ---- 안쪽 -------------------------------------------------------------

  note(kind, text, detail) {
    const entry = this.ports.store.log(kind, text, detail)
    this.emit('log', entry)
    return entry
  }

  alert(title, body) {
    if (this.policy.notifications) this.ports.notifier.notify(title, body)
  }

  savePolicy() {
    this.ports.store.savePolicy(this.policy)
  }

  /** 한 틱 안의 여러 변화를 한 번의 알림으로 묶는다. */
  publish() {
    if (this.publishQueued) return
    this.publishQueued = true
    queueMicrotask(() => {
      this.publishQueued = false
      this.emit('state', this.snapshot())
    })
  }
}
