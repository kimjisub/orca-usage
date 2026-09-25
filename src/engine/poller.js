
// 429 는 Retry-After: 0 으로 오는 일이 잦다. 그대로 믿으면 쉬지 않고 다시 때린다.
// 연속으로 막히면 배로 늘려 예산을 그만 태운다.
const MIN_BACKOFF_MS = 5 * 60_000
const MAX_BACKOFF_MS = 60 * 60_000
// 계정 사이 간격. 넷을 한꺼번에 때리면 429 를 자초한다.
const GAP_MS = 400

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 계정 목록을 한 바퀴 돌며 사용량을 갱신한다. 계정 하나가 끝날 때마다
 * onAccount 를 부른다.
 *
 * 입출력은 전부 ports 로 받는다(engine/ports.js). 이 파일은 순서만 정한다.
 *
 * @param {object} options
 * @param {boolean} options.force        캐시와 백오프를 무시한다 (r 키)
 * @param {boolean} options.forceRefresh 만료 전이라도 토큰을 다시 만든다 (t 키)
 * @param {string[]} [options.only]      이 계정 id 만 돈다
 * @param {(result: {ok: boolean, error: string|null}) => void} [options.onOrca]
 *   Orca 에 물은 결과. 연결 상태를 따로 들고 있는 쪽이 쓴다
 * @param {import('./ports.js').Ports} ports
 */
export async function pollOnce(accounts, {
  allowRefresh = true, force = false, forceRefresh = false, only = null,
  freshForMs = 270_000, onAccount = () => {}, onOrca = () => {},
} = {}, ports) {
  const { orca: orcaPort, keychain, store } = ports
  const cache = store.loadCache()
  const history = store.loadHistory()
  const targets = only ? accounts.filter((a) => only.includes(a.id)) : accounts
  const rows = []

  // 사용량은 Orca 에서 먼저 받는다. Orca 는 우리와 같은 엔드포인트를 같은
  // 자격증명으로 치므로, 둘이 따로 치면 계정당 5분 5회 예산을 활성 계정에서
  // 넘겨 429 백오프에 걸린다. 한 번의 조회로 전 계정이 오고 활성 계정도 함께
  // 온다. Orca 가 꺼져 있거나 어느 계정의 조회가 실패했으면 그 계정만 아래의
  // 직접 조회로 간다. 토큰을 다시 만드는 t 키는 처음부터 직접 경로다. 그 키의
  // 목적이 우리 쪽 자격증명을 손보는 것이라서다.
  let orca = null
  if (!forceRefresh) {
    try {
      orca = await orcaPort.fetchLimits({ refreshUsage: true })
      onOrca({ ok: true, error: null })
    } catch (error) {
      // Orca 가 안 떠 있다. 아래에서 계정마다 직접 조회한다.
      onOrca({ ok: false, error: error?.message ?? String(error) })
    }
  }
  const activeIds = orca
    ? { claude: orca.claude.activeId, codex: orca.codex.activeId }
    : {}

  for (const [position, account] of targets.entries()) {
    const entry = { ...(cache[account.id] ?? {}) }
    const now = Date.now()

    const got = orca?.[account.provider]?.byId.get(account.id) ?? null
    // Codex 는 직접 조회 경로가 없다. Orca 값이 없으면 캐시를 그대로 보여 준다.
    // Claude 는 Orca 가 받아 냈으면 옮겨 적고, 아니면 아래에서 직접 친다. 실패한
    // 응답에 실려 온 값으로는 직접 조회를 건너뛰지 않는다. 그쪽이 더 새 값을
    // 가져올 수 있어서다.
    if (account.provider === 'codex' || (got?.usage && !got.stale)) {
      if (got?.usage) {
        entry.usage = got.usage
        if (account.provider === 'codex') entry.credits = got.credits ?? null
        if (got.stale) {
          // 조회가 실패한 응답에 함께 실려 온 지난 값이다. 화면에는 보이되
          // 받은 시각은 그대로 둔다. 실패 시각으로 갱신하면 낡은 값이 방금 받은
          // 것처럼 읽히고, 이력에 쌓으면 아무도 관측하지 않은 표본이 생긴다.
          entry.fetchedAt = entry.fetchedAt ?? got.fetchedAt ?? null
          if (got.authFailed) entry.authFailed = true
        } else {
          entry.fetchedAt = got.fetchedAt ?? Date.now()
          // Orca 가 받아 냈으면 그 계정의 토큰은 살아 있다.
          delete entry.authFailed
          delete entry.retryUntil
          delete entry.blockedStreak
          // 표본 시각은 Orca 가 받은 시각이다. 지금 시각으로 찍으면 Orca 가 갱신을
          // 미룬 동안 같은 값이 새 표본처럼 쌓인다. 같은 시각이면 store 가 거른다.
          store.appendHistory(history, account.id, got.usage.windows, entry.fetchedAt)
        }
      }
      cache[account.id] = entry
      const row = {
        ...account,
        active: activeIds[account.provider]
          ? account.id === activeIds[account.provider]
          : Boolean(account.active),
        usage: entry.usage ?? null,
        fetchedAt: entry.fetchedAt ?? null,
        credits: entry.credits ?? null,
        refreshedAt: entry.refreshedAt ?? null,
        expiresAt: entry.expiresAt ?? null,
        retryUntil: null,
        authFailed: Boolean(entry.authFailed),
        note: got?.note ?? null,
        source: got?.usage && !got.stale ? 'orca' : (orca ? 'orca-miss' : 'cache'),
      }
      rows.push(row)
      onAccount(row)
      continue
    }

    const fresh = !force && now - (entry.fetchedAt ?? 0) < freshForMs
    const blocked = !force && now < (entry.retryUntil ?? 0)
    // Orca 가 이 계정을 못 받았으면 그 사유부터 들고 시작한다. 직접 조회가 되면
    // 아래에서 덮인다.
    let note = got?.note ?? null

    if (fresh) {
      // 캐시가 아직 신선하다. 호출 예산을 아낀다.
    } else if (blocked) {
      // 백오프 중이다. 화면은 retryUntil 로 남은 시간을 직접 보여준다.
    } else {
      if (position) await sleep(GAP_MS)
      let token = null
      try {
        const result = await keychain.ensureToken(account.id, {
          allowRefresh, lastRefreshAt: entry.refreshedAt ?? 0, force: forceRefresh,
        })
        token = result.token
        note = result.note
        entry.expiresAt = result.expiresAt ?? entry.expiresAt
        if (result.refreshed) {
          entry.refreshedAt = Date.now()
          // 갱신 성공은 백그라운드가 알아서 한 일이라 화면에 남길 이유가 없다.
          note = null
        }
        // 사람이 다시 로그인해야 풀리는 실패만 표시한다. 네트워크나 잠긴 키체인
        // 때문에 한 번 실패한 것까지 붙이면, 다음 조회에 나을 계정을 두고
        // 재로그인하라고 말하게 된다.
        if (result.authFailed) entry.authFailed = true
      } catch (error) {
        note = error instanceof Error ? error.message : String(error)
        // 다시 로그인해야 풀리는 실패만 표시한다(CredentialError 의 fatal).
        if (error?.fatal) entry.authFailed = true
      }

      if (token) {
        const { data, error, retryAfter } = await keychain.fetchUsage(token)
        if (data) {
          const usage = keychain.normalize(data)
          entry.usage = usage
          entry.fetchedAt = Date.now()
          delete entry.retryUntil
          delete entry.blockedStreak
          // 조회가 통했으면 그 토큰은 살아 있다. 앞서 붙은 표시를 여기서 푼다.
          delete entry.authFailed
          store.appendHistory(history, account.id, usage.windows)
        } else if (error === '호출 예산 소진') {
          // 백오프는 스스로 풀리고 사용자가 할 일이 없다. 사유로 남기면 계정
          // 이름 옆이 늘 시끄러워지므로, 값이 오래 낡았을 때만 화면이 알린다.
          const streak = (entry.blockedStreak ?? 0) + 1
          entry.blockedStreak = streak
          const backoff = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** (streak - 1))
          entry.retryUntil = Date.now() + Math.max(backoff, (retryAfter ?? 0) * 1000)
        } else {
          note = note ? `${error} / ${note}` : error
          if (retryAfter) entry.retryUntil = Date.now() + retryAfter * 1000
        }
      }
    }

    cache[account.id] = entry
    const row = {
      ...account,
      active: activeIds.claude ? account.id === activeIds.claude : Boolean(account.active),
      usage: entry.usage ?? null,
      fetchedAt: entry.fetchedAt ?? null,
      refreshedAt: entry.refreshedAt ?? null,
      expiresAt: entry.expiresAt ?? null,
      retryUntil: entry.retryUntil ?? null,
      authFailed: Boolean(entry.authFailed),
      note,
      source: orca ? 'orca-miss' : 'direct',
    }
    rows.push(row)
    onAccount(row)
  }

  store.saveCache(cache)
  store.saveHistory(history)
  return rows
}

/** 조회 없이 캐시만 읽어 계정 행을 세운다. 백엔드가 켜자마자 보여 줄 값이다. */
export function rowsFromCache(accounts, store) {
  const cache = store.loadCache()
  return accounts.map((account) => {
    const entry = cache[account.id] ?? {}
    return {
      ...account,
      usage: entry.usage ?? null,
      fetchedAt: entry.fetchedAt ?? null,
      refreshedAt: entry.refreshedAt ?? null,
      expiresAt: entry.expiresAt ?? null,
      retryUntil: entry.retryUntil ?? null,
      authFailed: Boolean(entry.authFailed),
      credits: entry.credits ?? null,
      note: null,
    }
  })
}
