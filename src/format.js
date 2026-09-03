const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** 창 라벨에서 주기를 읽는다. 모델별 한도는 주간 창이다. */
export function periodFor(label) {
  if (label === '5h') return 5 * HOUR_MS
  if (label === '7d') return 7 * DAY_MS
  return 7 * DAY_MS
}

/**
 * 창 안에서 시간이 얼마나 지났는지(0~1). 사용률과 나란히 놓으면 지금 앞서
 * 쓰고 있는지 아껴 쓰고 있는지가 바로 보인다.
 */
export function elapsedRatio(label, resetsAt, now = Date.now()) {
  if (!resetsAt) return null
  const target = Date.parse(resetsAt)
  if (Number.isNaN(target)) return null
  const period = periodFor(label)
  const remaining = target - now
  if (remaining <= 0) return 1
  if (remaining >= period) return 0
  return 1 - remaining / period
}

export function msUntil(resetsAt, now = Date.now()) {
  if (!resetsAt) return null
  const target = Date.parse(resetsAt)
  return Number.isNaN(target) ? null : target - now
}

/** "2h 47m" 처럼 두 단위까지만 쓴다. 스크린샷의 resets 표기와 같은 모양이다. */
export function shortSpan(ms) {
  if (ms == null) return ''
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rest = minutes % 60
    return rest ? `${hours}h ${rest}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const rest = hours % 24
  return rest ? `${days}d ${rest}h` : `${days}d`
}

export function clockAt(ms, { withDate = false } = {}) {
  const when = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  const clock = `${pad(when.getHours())}:${pad(when.getMinutes())}`
  // 표본이 하루를 넘기면 시각만으로는 어제인지 오늘인지 알 수 없다.
  return withDate ? `${when.getMonth() + 1}/${when.getDate()} ${clock}` : clock
}

// ANSI 기본 여덟 색에 주황이 없다. 노랑은 초록과 붙어 보여 경고로 안 읽힌다.
export const ORANGE = '#ff9f0a'

/**
 * 색은 절대량이 아니라 속도로 정한다.
 *
 * 창이 얼마나 찼는지만 보면 5시간 창의 60% 가 위험한지 알 수 없다. 4시간이
 * 지났으면 오히려 아껴 쓴 것이고, 30분 만에 그랬으면 곧 막힌다. 그래서 경과한
 * 시간보다 많이 썼으면 주황이다. 다만 90% 를 넘으면 속도와 무관하게 곧 막히므로
 * 빨강으로 덮는다.
 */
export function shadeFor(pct, elapsed = null) {
  if (pct >= 90) return 'red'
  if (elapsed != null && pct / 100 > elapsed) return ORANGE
  return 'green'
}

/**
 * 계정 전체를 하나의 리소스로 묶는다. 같은 이름의 창끼리 합쳐서 "네 계정 중
 * 얼마를 썼나" 로 본다. 계정 요금제가 같아야 성립하는 셈이고, 지금 이 맥의
 * 계정은 넷 다 같은 등급이다.
 */
export function aggregateWindows(rows, now = Date.now()) {
  const byLabel = new Map()
  for (const row of rows) {
    for (const window of row.usage?.windows ?? []) {
      const entry = byLabel.get(window.label) ?? {
        label: window.label, sum: 0, count: 0, elapsedSum: 0, elapsedCount: 0,
        soonest: null,
      }
      entry.sum += window.pct
      entry.count += 1
      const elapsed = elapsedRatio(window.label, window.resetsAt, now)
      if (elapsed != null) {
        entry.elapsedSum += elapsed
        entry.elapsedCount += 1
      }
      const left = msUntil(window.resetsAt, now)
      // 가장 먼저 풀리는 것을 쓴다. 전체가 한꺼번에 돌아오지는 않지만,
      // 다음에 숨통이 트이는 시각이 기다리는 쪽에 필요한 값이다.
      if (left != null && left >= 0 && (entry.soonest == null || left < entry.soonest)) {
        entry.soonest = left
      }
      byLabel.set(window.label, entry)
    }
  }
  return [...byLabel.values()].map((entry) => ({
    label: entry.label,
    pct: entry.count ? entry.sum / entry.count : 0,
    elapsed: entry.elapsedCount ? entry.elapsedSum / entry.elapsedCount : null,
    soonest: entry.soonest,
    used: entry.sum / 100,
    capacity: entry.count,
  }))
}

const ACCOUNT_WINDOWS = new Set(['5h', '7d'])

const isModelWindow = (label) => !ACCOUNT_WINDOWS.has(label)

/** 화면에 그릴 창. 모델별 한도는 f 로 끌 수 있다. */
export function visibleWindows(windows, showModelWindows) {
  if (!windows) return []
  return showModelWindows ? windows : windows.filter((w) => !isModelWindow(w.label))
}
