/**
 * 엔진 테스트용 가짜 어댑터. 실제 Orca, 키체인, 파일, 알림을 건드리지 않고
 * 무엇이 불렸는지만 적어 둔다.
 */

const HOUR = 3_600_000

export function claudeAccount(id, index, extra = {}) {
  return { id, provider: 'claude', email: `${id}@example.com`, label: 'Max 20x', index, ...extra }
}

export function codexAccount(id, index) {
  return { id, provider: 'codex', email: `${id}@example.com`, label: 'Pro', index }
}

/** Orca 가 돌려주는 한 계정의 한도. 5h 와 7d 사용률만 받는다. */
export function limits(now, { short = 10, weekly = 10, weeklyResetIn = 3 * 24 * HOUR } = {}) {
  return {
    usage: {
      windows: [
        { label: '5h', pct: short, resetsAt: new Date(now + 2 * HOUR).toISOString() },
        { label: '7d', pct: weekly, resetsAt: new Date(now + weeklyResetIn).toISOString() },
      ],
    },
    credits: null,
    fetchedAt: now,
    stale: false,
    authFailed: false,
    note: null,
  }
}

export function makePorts({ now, accounts, usage = {}, active = {}, expiry = {}, policy = {}, codexKnown = true }) {
  const calls = { select: [], refresh: [], peek: [], openWindow: [], notify: [], fetchLimits: 0, resetStatus: [], consume: [] }
  const state = {
    accounts,
    usage,
    active: { claude: null, codex: null, ...active },
    expiry: { ...expiry },
    refresh: {},
    refreshExpiry: {},
    resets: {},
    consumeResult: { outcome: 'reset', restored: true },
    policy: {
      autoSwitch: false, keepAlive: false, notifications: true, tuning: {}, hiddenIds: [], lastSwitchAt: 0,
      ...policy,
    },
    cache: {},
    history: {},
    log: [],
    codexKnown,
    fetchDelay: 0,
  }

  const ports = {
    orca: {
      listAccounts: async () => ({ accounts: state.accounts, codexKnown: state.codexKnown }),
      activeIds: async () => ({ ...state.active }),
      select: async (provider, id) => {
        calls.select.push({ provider, id })
        state.active[provider] = id
      },
      consumeCodexResetCredit: async (id) => {
        calls.consume.push(id)
        if (state.consumeResult instanceof Error) throw state.consumeResult
        return state.consumeResult
      },
      fetchLimits: async () => {
        calls.fetchLimits += 1
        if (state.fetchDelay) await new Promise((resolve) => setTimeout(resolve, state.fetchDelay))
        const byProvider = (provider) => {
          const byId = new Map()
          for (const account of state.accounts.filter((entry) => entry.provider === provider)) {
            if (state.usage[account.id]) byId.set(account.id, state.usage[account.id])
          }
          return byId
        }
        return {
          claude: { activeId: state.active.claude, byId: byProvider('claude') },
          codex: { activeId: state.active.codex, byId: byProvider('codex'), accounts: [] },
        }
      },
    },
    keychain: {
      ensureToken: async () => ({ token: null, note: null, refreshed: false, expiresAt: null }),
      fetchUsage: async () => ({ data: null, error: '쓰지 않음', retryAfter: null }),
      normalize: (data) => data,
      peekToken: async (id) => {
        calls.peek.push(id)
        return {
          expiresAt: state.expiry[id] ?? null,
          refresh: state.refresh[id] ?? `r-${id}`,
          refreshExpiresAt: state.refreshExpiry[id] ?? null,
        }
      },
      refresh: async (id) => {
        calls.refresh.push(id)
        state.expiry[id] = now() + 8 * HOUR
        state.refresh[id] = `${state.refresh[id] ?? `r-${id}`}+`
        return { refreshed: true, expiresAt: state.expiry[id], note: null, authFailed: false, revoked: false }
      },
      resetStatus: async (id) => {
        calls.resetStatus.push(id)
        return state.resets[id] ?? { status: null, error: '없음' }
      },
      openWindow: async (id) => {
        calls.openWindow.push(id)
        return { ok: true, refreshed: false }
      },
    },
    store: {
      loadCache: () => structuredClone(state.cache),
      saveCache: (cache) => { state.cache = structuredClone(cache) },
      updateCache: (id, patch) => { state.cache[id] = { ...(state.cache[id] ?? {}), ...patch } },
      loadHistory: () => structuredClone(state.history),
      saveHistory: (history) => { state.history = structuredClone(history) },
      appendHistory: (history, id, windows, at = now()) => {
        const series = history[id] ?? []
        const point = { at }
        for (const window of windows) point[window.label] = window.pct
        series.push(point)
        history[id] = series
        return history
      },
      loadPolicy: () => structuredClone(state.policy),
      savePolicy: (next) => { state.policy = structuredClone(next) },
      log: (kind, text, detail = {}) => {
        const entry = { at: now(), kind, text, ...detail }
        state.log.push(entry)
        return entry
      },
      loadLog: () => [...state.log].reverse(),
    },
    notifier: {
      notify: (title, body) => calls.notify.push({ title, body }),
    },
  }
  return { ports, calls, state }
}
