import { elapsedRatio, msUntil } from './format.js'
import { tuning } from './tuning.js'





const HOUR_MS = 3_600_000
// 5시간 창은 다섯 시간에 100% 라 최대 소비가 시간당 20%p 다.
const SHORT_MAX_BURN = 20
// 앞을 내다보는 창. 5시간 창 하나 길이라 "지금 붙으면 한 창 동안 얼마나 일할
// 수 있나" 를 잰다.
const LOOKAHEAD_H = 5
// 5시간 창을 100% 채우면 7일 창이 20%p 오른다. 실측 2026-09-07 에 네 계정이
// 0.18~0.20 으로 나왔고 사용자도 같은 값을 확인했다.
const WEEKLY_PER_SHORT_WINDOW = 20
// 그래서 7일 창을 태우는 최대 속도는 정해져 있다. 5시간에 20%p, 시간당 4%p 다.
// 관측 속도가 이보다 클 수 없으므로 하한이 아니라 상한이다.
export const WEEKLY_MAX_BURN = WEEKLY_PER_SHORT_WINDOW / LOOKAHEAD_H

const windowOf = (row, label) => (row.usage?.windows ?? []).find((w) => w.label === label)

/**
 * 7일 창의 소비 속도(시간당 %p).
 *
 * 5시간 창의 속도로 대신 계산하면 안 된다. 두 창은 한도가 달라 같은 토큰이
 * 서로 다른 폭으로 올라간다. 7일 창은 정수 % 로만 보고돼 짧은 구간에서는
 * 계단만 남으므로, 표본 전체를 한 구간으로 놓고 기울기를 낸다.
 */
function weeklyBurn(history) {
  const points = (history ?? []).filter((point) => typeof point['7d'] === 'number')
  // 마지막 리셋 뒤만 본다. 리셋을 넘겨 처음과 끝을 이으면 값이 떨어진 만큼이
  // 소비를 상쇄해 0 이 나온다. 실측 2026-09-06: 56% 에서 리셋 뒤 7% 가 된 계정이
  // 속도 0 으로 잡혀 "이 속도로 넉넉" 이 떴다.
  let start = 0
  for (let index = 1; index < points.length; index += 1) {
    if (points[index]['7d'] < points[index - 1]['7d']) start = index
  }
  const since = points.slice(start)
  if (since.length < 2) return null
  const first = since[0]
  const last = since.at(-1)
  const hours = (last.at - first.at) / HOUR_MS
  if (hours <= 0) return null
  return Math.max(0, last['7d'] - first['7d']) / hours
}


/**
 * 앞으로 LOOKAHEAD_H 시간 동안 이 계정으로 태울 수 있는 총량.
 *
 * 지금 남은 양만 보면 5시간 창이 30분 뒤 리셋되는 계정이 손해로 보인다. 실제로는
 * 30분 뒤 쿼터가 통째로 새로 채워져 그 뒤로 계속 쓸 수 있다. 남은 양과 리셋 시각을
 * 함께 봐야 "지금 붙어서 얼마나 일할 수 있나" 가 나온다.
 */
function reachableIn(burst, shortResetInMs) {
  const resetAt = shortResetInMs == null ? Infinity : shortResetInMs / HOUR_MS
  if (resetAt >= LOOKAHEAD_H) return Math.min(burst, SHORT_MAX_BURN * LOOKAHEAD_H)
  const beforeReset = Math.min(burst, SHORT_MAX_BURN * resetAt)
  const afterReset = Math.min(100, SHORT_MAX_BURN * (LOOKAHEAD_H - resetAt))
  return beforeReset + afterReset
}


// 뒤처짐이 이만큼이면 최대로 본다. 창의 절반을 통째로 안 쓴 상태다. 100 을
// 기준으로 삼으면 현실에서 나오는 10~30%p 가 0.1~0.3 으로 눌려, 여력 같은
// 지표에 늘 밀린다.
const BEHIND_FULL = 50

/**
 * 지금 붙기 좋은 정도를 하나의 점수로 낸다.
 *
 * 세 가지를 본다. 창이 흐른 만큼 안 썼는가, 지금 붙으면 얼마나 일할 수 있는가,
 * 그리고 주간에 얼마가 남았는가. 서로 다른 것을 재므로 하나가 크다고 다른
 * 것이 따라 커지지 않는다.
 *
 * 예전에는 소멸과 급함을 따로 세었는데 둘은 같은 값이었다. 소멸은
 * 최대속도 x 남은시간 x (급함 - 1) 이라, 소멸이 0 보다 크다는 것과 급함이 1 을
 * 넘는다는 것이 같은 말이다. 지표 넷 중 둘이 같은 것을 재고 있었다.
 *
 * 가중치 합으로 나누므로 점수는 늘 0 부터 100 이다. 사람이 가중치를 바꿔도
 * 눈금이 그대로다.
 *
 * @returns {{total: number, parts: object[]}}
 */
function scoreOf(entry) {
  const weights = tuning()
  const items = [
    {
      key: 'behind',
      label: '뒤처짐',
      tuningKey: 'weightBehind',
      what: '주간 창이 흐른 만큼 안 쓴 양',
      how: `경과 비율에서 사용률을 뺀 값. ${BEHIND_FULL}%p 면 최대`,
      raw: `${Math.round(entry.weeklyBehind)}%p`,
      weight: weights.weightBehind,
      norm: Math.min(1, entry.weeklyBehind / BEHIND_FULL),
    },
    {
      key: 'now',
      label: '당장',
      tuningKey: 'weightNow',
      what: '지금 붙어 다섯 시간에 쓸 양',
      how: '5h 창이 비어 있고 곧 리셋되면 크다',
      raw: `${Math.round(entry.reachable)}%`,
      weight: weights.weightNow,
      norm: Math.min(1, entry.reachable / 100),
    },
    {
      key: 'reserve',
      label: '여력',
      tuningKey: 'weightReserve',
      what: '주간에 남은 양',
      how: '100 에서 7d 사용률을 뺀 값',
      raw: `${Math.round(entry.reserve)}%`,
      weight: weights.weightReserve,
      norm: Math.min(1, entry.reserve / 100),
    },
  ]
  const sum = items.reduce((total, item) => total + item.weight, 0)
  if (sum <= 0) return { total: 0, parts: items.map((item) => ({ ...item, value: 0 })) }
  const parts = items.map((item) => ({
    key: item.key,
    label: item.label,
    tuningKey: item.tuningKey,
    what: item.what,
    how: item.how,
    // 정규화 전 값. 점수가 왜 그런지는 이것과 가중치를 함께 봐야 안다.
    raw: item.raw,
    weight: item.weight,
    value: (item.weight * item.norm / sum) * 100,
  }))
  return { total: parts.reduce((total, part) => total + part.value, 0), parts }
}

/**
 * 계정마다 지금 상태와 남은 여력을 매긴다.
 *
 * 장기 자원은 7일 창이다. 5시간 창은 하루에 네다섯 번 새로 채워지므로 다 써도
 * 몇 시간이면 돌아오지만, 7일 창은 한 번 차면 며칠을 기다린다. 다만 두 창 모두
 * 리셋 전에 안 쓴 몫은 그대로 사라지므로, 남은 양만이 아니라 남은 시간까지
 * 봐야 "지금 어디에 붙을까" 가 갈린다.
 */
export function scoreAccounts(rows, historyById, now = Date.now()) {
  return rows.map((row) => {
    const short = windowOf(row, '5h')
    const weekly = windowOf(row, '7d')
    const shortPct = short?.pct ?? 0
    const weeklyPct = weekly?.pct ?? 0
    const shortResetIn = msUntil(short?.resetsAt, now)
    const weeklyResetIn = msUntil(weekly?.resetsAt, now)
    const burn = weeklyBurn(historyById?.[row.id])

    const burst = 100 - shortPct
    const reserve = 100 - weeklyPct
    // 주간 창이 흐른 비율과 실제 사용률의 차. 양수면 뒤처졌고 음수면 앞서 썼다.
    const weeklyGap = (elapsedRatio('7d', weekly?.resetsAt, now) ?? 0) * 100 - weeklyPct

    return {
      row,
      index: row.index,
      email: row.email,
      hasData: Boolean(row.usage?.windows?.length),
      // 자격증명이 끊긴 계정은 숫자가 아무리 좋아도 붙을 수 없다. 캐시에 남은
      // 사용량만 보면 여기로 옮겨 놓고 새 세션마다 인증에 실패하게 된다.
      authFailed: Boolean(row.authFailed),
      shortPct,
      weeklyPct,
      // 지금 당장 더 태울 수 있는 양. 5시간 창이 곧 회복되므로 한때의 제약이다.
      burst,
      // 며칠을 좌우하는 진짜 여력.
      reserve,
      shortBlocked: shortPct >= tuning().blockedAt,
      weeklyBlocked: weeklyPct >= tuning().blockedAt,
      shortResetIn,
      weeklyResetIn,
      burn,
      // 이 속도로 계속 태우면 주간 여력이 몇 시간 남았나.
      runwayHours: burn > 0 ? reserve / burn : null,
      // 주간 창이 흐른 만큼 안 쓴 양(%p). 창의 절반이 지났는데 20% 만 썼으면
      // 30 이다. 앞서 썼으면 0 이고 그때는 아껴 둘 계정이다.
      weeklyBehind: Math.max(0, weeklyGap),
      // 창이 흐른 것보다 앞서 쓴 양(%p). 이대로 가면 리셋 전에 바닥이 난다.
      weeklyAhead: Math.max(0, -weeklyGap),
      // 지금 붙으면 다섯 시간 동안 얼마나 태울 수 있나.
      reachable: reachableIn(burst, shortResetIn),
    }
  }).map((entry) => ({ ...entry, score: scoreOf(entry) }))
}

/** 왜 이 계정인지 한 줄로. 근거가 없으면 추천도 못 믿는다. */
function reasonFor(entry) {
  if (entry.weeklyBehind >= tuning().wasteAlert) {
    return `주간 ${Math.round(entry.weeklyBehind)}%p 뒤처짐`
  }
  return `주간 ${Math.round(entry.reserve)}%  5h ${Math.round(entry.burst)}% 남음`
}

/**
 * 세 가지를 답한다. 지금 붙을 계정, 큰 작업을 맡길 계정, 손대지 말 계정.
 *
 * 순서는 소멸이 먼저다. 리셋 전에 버려질 쿼터가 있으면 그것부터 태우는 쪽이
 * 총량에서 이득이고, 버려질 것이 없을 때에야 주간 여력이 큰 계정을 고른다.
 * 주간이 반쯤 찼어도 리셋이 코앞이면 아낄 이유가 없다. 같은 사용률이라도
 * 리셋이 멀면 아껴야 하고 가까우면 태워야 한다.
 */
export function advise(rows, historyById, now = Date.now()) {
  const scored = scoreAccounts(rows, historyById, now).filter((entry) => entry.hasData)
  if (scored.length === 0) return null

  const open = scored.filter((entry) =>
    !entry.shortBlocked && !entry.weeklyBlocked && !entry.authFailed)

  // 순위는 네 지표에 가중치를 곱해 더한 점수다. 무엇이 얼마나 밀었는지는
  // score.parts 에 남아 화면에서 그대로 읽힌다. 같으면 주간 여력으로 가른다.
  const byScore = (a, b) => (b.score.total - a.score.total) || (b.reserve - a.reserve)

  const use = [...open].sort(byScore)[0] ?? null
  // 큰 작업은 5시간 창을 보지 않는다. 지금 막혀 있어도 몇 시간이면 풀리고,
  // 긴 작업에서 정작 발목을 잡는 것은 주간 여력이다.
  const heavy = [...scored]
    .filter((entry) => !entry.weeklyBlocked && !entry.authFailed)
    .sort((a, b) => b.reserve - a.reserve || b.burst - a.burst)[0] ?? null

  // 아껴 둘 계정은 창이 흐른 것보다 앞서 쓴 쪽이다. 이대로 가면 리셋 전에
  // 바닥이 난다. 많이 썼다는 것만으로는 모자란다. 리셋이 코앞이면 남은 몫이
  // 어차피 사라져 아끼는 것이 오히려 손해라서다.
  const avoid = [...scored]
    .filter((entry) => entry.weeklyPct >= tuning().spareAt
      && entry.weeklyAhead >= tuning().wasteAlert)
    .sort((a, b) => b.weeklyAhead - a.weeklyAhead)[0] ?? null

  // 계정마다 배지 하나. 겹치면 급한 쪽이 이긴다. 막힌 것을 먼저 알려야 하고,
  // 소멸 임박은 지금 안 하면 사라지므로 단순 추천보다 급하다.
  const badges = {}
  for (const entry of scored) {
    if (entry.shortBlocked || entry.weeklyBlocked) badges[entry.row.id] = 'blocked'
    else if (entry.weeklyBehind >= tuning().wasteAlert) badges[entry.row.id] = 'spurt'
  }
  if (use && !badges[use.row.id]) badges[use.row.id] = 'use'
  if (avoid && !badges[avoid.row.id]) badges[avoid.row.id] = 'spare'

  const soonestUnblock = scored
    .filter((entry) => entry.shortBlocked && entry.shortResetIn != null && entry.shortResetIn > 0)
    .sort((a, b) => a.shortResetIn - b.shortResetIn)[0] ?? null

  return {
    badges,
    // 전환 판정과 화면이 같은 점수를 본다. 두 곳이 따로 계산하면 어긋난다.
    scores: Object.fromEntries(scored.map((entry) => [entry.row.id, entry.score])),
    use,
    useReason: use ? reasonFor(use) : null,
    heavy,
    avoid,
    allBlocked: open.length === 0,
    soonestUnblock,
    // 계정을 통틀어 남은 주간 여력. 계정 하나치를 1 로 센다.
    totalReserve: scored.reduce((sum, entry) => sum + entry.reserve, 0) / 100,
    accountCount: scored.length,
  }
}
