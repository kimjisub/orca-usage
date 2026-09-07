import { WASTE_ALERT, WEEKLY_MAX_BURN, scoreAccounts } from './advice.js'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/**
 * 시각 t 에 이 계정이 열어 줄 주간 여력(%).
 *
 * 5h 가 막혀 있고 t 가 그 리셋 전이면 0 이다. 미래의 5h 는 예측하지 않는다.
 * 쓰기 시작해야 창이 열리는 구조라 지금 막힌 것이 언제 풀리는지만 확정이다.
 *
 * 주간은 리셋 시각을 확정으로 두고, 그 사이는 관측한 소비 속도로 이어 본다.
 * 리셋 뒤에도 같은 속도로 계속 쓴다고 보므로 며칠 뒤 다시 줄어드는 것이 그
 * 가정의 결과다. 속도를 모르면(표본 부족) 리셋만 반영한다.
 */
export function availableAt(entry, t, now) {
  if (entry.shortBlocked && entry.shortResetIn != null && t < now + entry.shortResetIn) return 0
  const burn = entry.burn ?? 0
  const weeklyResetAt = entry.weeklyResetIn == null ? Infinity : now + entry.weeklyResetIn
  if (t >= weeklyResetAt) return Math.max(0, 100 - burn * ((t - weeklyResetAt) / HOUR_MS))
  return Math.max(0, entry.reserve - burn * ((t - now) / HOUR_MS))
}

/**
 * 시각 t 가 이 계정을 태워야 할 때인가.
 *
 * 리셋까지 24시간 안이고, 그때까지 관측된 최대 속도로 태워도 WASTE_ALERT 넘게
 * 남을 때다. 화면 배지의 소진 권장과 같은 기준이라 둘이 어긋나지 않는다.
 */
export function spurtAt(entry, t, now, maxBurn) {
  if (entry.weeklyResetIn == null) return false
  const weeklyResetAt = now + entry.weeklyResetIn
  if (t >= weeklyResetAt || weeklyResetAt - t > DAY_MS) return false
  return availableAt(entry, t, now) - maxBurn * ((weeklyResetAt - t) / HOUR_MS) > WASTE_ALERT
}

/** 해당 날짜의 0시. 한 칸이 한 시간이라 그 날의 24칸을 여기서부터 센다. */
function startOfDay(at) {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/**
 * 앞으로 7일의 시간별 가용과 오늘의 계정별 가용.
 *
 * 일주일 격자는 계정별 가용의 평균이다. 어느 계정이든 열려 있으면 일할 수 있으
 * 므로 합쳐서 본다. 오늘 행은 계정마다 따로다. 지금 어느 계정이 막혔고 언제
 * 풀리는지는 합치면 사라진다.
 *
 * @returns {null | {
 *   days: { weekday: number, today: boolean, cells: ({avail: number, spurt: boolean}|null)[] }[],
 *   today: { index: number, email: string, shortPct: number, blockedUntil: number|null, cells: (number|null)[] }[],
 *   hasBurn: boolean,
 * }}
 */
export function buildSchedule(rows, historyById, now = Date.now()) {
  const scored = scoreAccounts(rows, historyById, now).filter((entry) => entry.hasData)
  if (scored.length === 0) return null
  const burns = scored.map((entry) => entry.burn).filter((value) => typeof value === 'number' && value > 0)
  // 지난 시간은 비운다. 이번 시간은 아직 진행 중이라 남긴다.
  const from = now - HOUR_MS
  const todayStart = startOfDay(now)

  const days = []
  for (let offset = 0; offset < 7; offset += 1) {
    const dayStart = startOfDay(todayStart + offset * DAY_MS + HOUR_MS)
    const cells = []
    for (let hour = 0; hour < 24; hour += 1) {
      const t = dayStart + hour * HOUR_MS
      if (t < from) {
        cells.push(null)
        continue
      }
      const avail = scored.reduce((sum, entry) => sum + availableAt(entry, t, now), 0) / scored.length
      cells.push({ avail, spurt: scored.some((entry) => spurtAt(entry, t, now, WEEKLY_MAX_BURN)) })
    }
    days.push({ weekday: new Date(dayStart).getDay(), today: offset === 0, cells })
  }

  const today = scored.map((entry) => ({
    index: entry.index,
    email: entry.email,
    shortPct: entry.shortPct,
    blockedUntil: entry.shortBlocked && entry.shortResetIn != null ? now + entry.shortResetIn : null,
    cells: Array.from({ length: 24 }, (_, hour) => {
      const t = todayStart + hour * HOUR_MS
      return t < from ? null : availableAt(entry, t, now)
    }),
  }))

  return { days, today, hasBurn: burns.length > 0 }
}
