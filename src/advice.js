import { msUntil } from './format.js'

// 이 위로는 곧 막히는 것으로 본다.
const BLOCKED_AT = 90
// 주간을 이만큼 쓴 계정은 아껴 둘 대상으로 알린다.
const SPARE_AT = 50
// 이만큼 넘게 버려질 판이면 소멸 임박으로 본다.
const WASTE_ALERT = 15
// 5시간 창은 꽉 채우는 일이 드물어 늘 얼마쯤 버려진다. 상시로 뜨면 신호가
// 안 되므로 정렬에는 쓰되 이유로 내세우는 문턱은 훨씬 높게 잡는다.
const SHORT_WASTE_ALERT = 45

const HOUR_MS = 3_600_000
// 5시간 창은 다섯 시간에 100% 라 최대 소비가 시간당 20%p 다.
const SHORT_MAX_BURN = 20
// 앞을 내다보는 창. 5시간 창 하나 길이라 "지금 붙으면 한 창 동안 얼마나 일할
// 수 있나" 를 잰다.
const LOOKAHEAD_H = 5
// 7일 창을 얼마나 빨리 태울 수 있는지는 관측으로만 안다. 표본이 없을 때 쓸 하한.
const WEEKLY_MAX_BURN_FLOOR = 3

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
  if (points.length < 2) return null
  const first = points[0]
  const last = points.at(-1)
  const hours = (last.at - first.at) / HOUR_MS
  if (hours <= 0) return null
  const delta = last['7d'] - first['7d']
  // 창이 리셋되면 값이 떨어진다. 소비가 아니라 초기화라 속도로 쓰지 않는다.
  return delta > 0 ? delta / hours : 0
}

/**
 * 리셋 전에 다 쓰려면 시간당 몇 %p 를 태워야 하는가.
 *
 * 남은 양만 보면 리셋이 이틀 뒤인 계정과 엿새 뒤인 계정이 같아 보인다. 남은
 * 시간으로 나누면 어느 쪽을 먼저 태워야 하는지가 하나의 수로 나온다. 여력이
 * 클수록, 리셋이 가까울수록 커진다.
 */
function burnNeeded(remaining, msLeft) {
  if (msLeft == null || msLeft <= 0) return Infinity
  return remaining / (msLeft / HOUR_MS)
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

/**
 * 리셋 전에 다 못 쓰고 버려질 양.
 *
 * 남은 쿼터가 많아도 리셋이 코앞이면 대부분 사라진다. 그 양이 클수록 지금
 * 그 계정을 태우는 것이 이득이다. 반대로 리셋이 멀면 버려질 것이 없으니
 * 아껴 두어도 손해가 아니다.
 */
function wastedIfIdle(remaining, msLeft, maxBurn) {
  if (msLeft == null || msLeft <= 0 || maxBurn <= 0) return 0
  const reachable = maxBurn * (msLeft / HOUR_MS)
  return Math.max(0, remaining - reachable)
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
  const burns = rows
    .map((row) => weeklyBurn(historyById?.[row.id]))
    .filter((value) => typeof value === 'number' && value > 0)
  // 이 사람이 실제로 낼 수 있는 속도를 관측에서 잡는다. 아무도 안 태웠으면 하한.
  const weeklyMaxBurn = Math.max(WEEKLY_MAX_BURN_FLOOR, ...burns)

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
    const shortNeed = burnNeeded(burst, shortResetIn)

    return {
      row,
      index: row.index,
      email: row.email,
      hasData: Boolean(row.usage?.windows?.length),
      shortPct,
      weeklyPct,
      // 지금 당장 더 태울 수 있는 양. 5시간 창이 곧 회복되므로 한때의 제약이다.
      burst,
      // 며칠을 좌우하는 진짜 여력.
      reserve,
      shortBlocked: shortPct >= BLOCKED_AT,
      weeklyBlocked: weeklyPct >= BLOCKED_AT,
      shortResetIn,
      weeklyResetIn,
      burn,
      // 이 속도로 계속 태우면 주간 여력이 몇 시간 남았나.
      runwayHours: burn > 0 ? reserve / burn : null,
      shortWaste: wastedIfIdle(burst, shortResetIn, SHORT_MAX_BURN),
      weeklyWaste: wastedIfIdle(reserve, weeklyResetIn, weeklyMaxBurn),
      // 리셋까지 다 쓰려면 시간당 얼마를 태워야 하는가. 클수록 먼저 손대야 한다.
      shortNeed,
      weeklyNeed: burnNeeded(reserve, weeklyResetIn),
      // 그 속도를 실제로 낼 수 있는 속도와 견준 값. 0 이면 가만 둬도 리셋 전에
      // 다 쓴다는 뜻이라 급할 것이 없다.
      //
      // 순위에 need 를 그대로 쓰면 안 된다. 넷 다 넉넉한 상황에서도 0.75 와
      // 0.57 처럼 값이 늘 달라 여기서 결판이 나고, 정작 "지금 붙으면 얼마나
      // 일할 수 있나" 를 못 본다. 여유로운 계정끼리는 나란히 두고 다음 기준으로
      // 넘긴다.
      weeklyUrgency: Math.max(0, burnNeeded(reserve, weeklyResetIn) / weeklyMaxBurn - 1),
      // 지금 붙으면 다섯 시간 동안 얼마나 태울 수 있나.
      reachable: reachableIn(burst, shortResetIn),
    }
  })
}

/** 왜 이 계정인지 한 줄로. 근거가 없으면 추천도 못 믿는다. */
function reasonFor(entry) {
  if (entry.weeklyWaste >= WASTE_ALERT) {
    return `주간 ${Math.round(entry.weeklyWaste)}% 소멸 임박`
  }
  if (entry.shortWaste >= SHORT_WASTE_ALERT) {
    return `5h ${Math.round(entry.shortWaste)}% 소멸 임박`
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

  const open = scored.filter((entry) => !entry.shortBlocked && !entry.weeklyBlocked)

  // 순서가 곧 이 도구의 판단이다. 주간이 먼저고 5시간 창이 나중이다.
  //
  // 1. 주간에서 확실히 버려질 양. 며칠을 기다려야 돌아오므로 되찾을 수 없다.
  // 2. 주간을 리셋 전에 다 쓰지 못할 판인가. 남은 양만 보면 사흘 뒤 리셋과
  //    엿새 뒤 리셋이 같아 보이는데, 시간으로 나누면 앞의 것이 두 배 급하다는
  //    사실이 드러난다. 다만 실제로 낼 수 있는 속도로 다 쓸 수 있는 계정끼리는
  //    여기서 가르지 않는다. 둘 다 넉넉하다는 뜻이라 순위의 근거가 못 된다.
  // 3. 주간 사정이 비슷할 때에야 5시간 창을 본다. 그것도 지금 남은 양이 아니라
  //    다섯 시간 동안 태울 수 있는 총량이다. 곧 리셋되는 계정은 남은 양이 적어도
  //    잠시 뒤 쿼터가 통째로 새로 채워진다.
  //
  // 5시간 창을 주간보다 앞세우지 않는 이유는 하루에 네다섯 번 새로 채워지기
  // 때문이다. 한 창을 놓치면 몇 시간 손해지만 주간을 놓치면 며칠이 간다.
  // 소수점 아래 미세한 차이로 순위가 갈리면 안 된다. 리셋 시각이 몇 밀리초 다른
  // 것만으로 다음 기준까지 못 가고 결판나 버린다.
  const coarse = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 1e9)
  const byUrgency = (a, b) => (
    (Math.round(b.weeklyWaste) - Math.round(a.weeklyWaste))
    || (coarse(b.weeklyUrgency) - coarse(a.weeklyUrgency))
    || (Math.round(b.reachable) - Math.round(a.reachable))
    // 다섯 시간 동안 태울 수 있는 양이 같으면 주간 여력이 큰 쪽으로 간다.
    // 5시간 창이 둘 다 비어 있을 때 이 자리가 실제로 순위를 가른다.
    || (Math.round(b.reserve) - Math.round(a.reserve))
  )

  const use = [...open].sort(byUrgency)[0] ?? null
  // 큰 작업은 5시간 창을 보지 않는다. 지금 막혀 있어도 몇 시간이면 풀리고,
  // 긴 작업에서 정작 발목을 잡는 것은 주간 여력이다.
  const heavy = [...scored]
    .filter((entry) => !entry.weeklyBlocked)
    .sort((a, b) => b.reserve - a.reserve || b.burst - a.burst)[0] ?? null

  // 아껴 둘 계정은 주간을 많이 썼으면서 리셋이 아직 먼 쪽이다. 리셋이 코앞이면
  // 남은 몫이 어차피 사라지므로 아끼는 것이 오히려 손해다.
  const avoid = [...scored]
    .filter((entry) => entry.weeklyPct >= SPARE_AT && entry.weeklyWaste < WASTE_ALERT)
    .sort((a, b) => b.weeklyPct - a.weeklyPct)[0] ?? null

  // 계정마다 배지 하나. 겹치면 급한 쪽이 이긴다. 막힌 것을 먼저 알려야 하고,
  // 소멸 임박은 지금 안 하면 사라지므로 단순 추천보다 급하다.
  const badges = {}
  for (const entry of scored) {
    if (entry.shortBlocked || entry.weeklyBlocked) badges[entry.row.id] = 'blocked'
    else if (entry.weeklyWaste >= WASTE_ALERT) badges[entry.row.id] = 'spurt'
  }
  if (use && !badges[use.row.id]) badges[use.row.id] = 'use'
  if (avoid && !badges[avoid.row.id]) badges[avoid.row.id] = 'spare'

  const soonestUnblock = scored
    .filter((entry) => entry.shortBlocked && entry.shortResetIn != null && entry.shortResetIn > 0)
    .sort((a, b) => a.shortResetIn - b.shortResetIn)[0] ?? null

  return {
    badges,
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
