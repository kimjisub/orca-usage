const isNumber = (value) => typeof value === 'number'

const SERIES_COLORS = ['green', 'yellow', 'cyan', 'magenta', 'blue']
const HOUR_MS = 3_600_000

/** 그래프가 담을 기간. 짧은 것부터 길게 순환한다. */
export const RANGES = [
  { label: '3h', ms: 3 * HOUR_MS },
  { label: '6h', ms: 6 * HOUR_MS },
  { label: '12h', ms: 12 * HOUR_MS },
  { label: '24h', ms: 24 * HOUR_MS },
  { label: '7d', ms: 7 * 24 * HOUR_MS },
  { label: '1M', ms: 31 * 24 * HOUR_MS },
]

export const colorForSeries = (index) => SERIES_COLORS[index % SERIES_COLORS.length]

// 최댓값 선은 같은 계열의 밝은 색으로 둔다. 다른 색을 주면 별개 창으로 읽힌다.
const PEAK_COLORS = ['lightgreen', 'lightyellow', 'lightcyan', 'lightmagenta', 'lightblue']

export const peakColorForSeries = (index) => PEAK_COLORS[index % PEAK_COLORS.length]

/**
 * 표본을 시간축에 올린다. 인덱스를 x 로 쓰면 표본이 적을 때 차트가 왼쪽 몇 칸에
 * 몰리고, 조회가 걸러진 구간이 없던 일처럼 압축된다. 시간으로 자리를 잡으면
 * 오른쪽 끝이 항상 가장 최근이고 칸 사이 간격이 실제 경과와 같다.
 *
 * 조회를 한두 번 거른 정도의 공백은 직전 값으로 잇는다. 그 사이에 값이 0 이 된
 * 것은 아니고, 칸 폭이 조회 간격보다 좁으면 잇지 않고서는 선이 서지 않는다.
 * 그보다 긴 공백은 비운다. 관측이 없던 구간을 이으면 화면에 없는 데이터가
 * 그려지고, 앱을 띄우기 전 시간까지 값이 깔린다.
 */
function resample(points, columns, range = null) {
  const empty = new Array(columns).fill(null)
  if (points.length === 0) return { values: empty, from: null, to: null }
  const from = range?.from ?? points[0].at
  const to = range?.to ?? points.at(-1).at
  const span = Math.max(1, to - from)

  const slots = new Array(columns).fill(null)
  for (const point of points) {
    const index = Math.max(0,
      Math.min(columns - 1, Math.round(((point.at - from) / span) * (columns - 1))))
    const slot = slots[index]
    if (slot == null) {
      slots[index] = { value: point.value, firstAt: point.at, lastAt: point.at }
      continue
    }
    // 같은 칸에 여러 표본이 들어오면 그 구간의 최댓값을 남긴다. 피크를 놓치면
    // 정작 봐야 할 순간이 사라진다.
    slot.value = Math.max(slot.value, point.value)
    slot.firstAt = Math.min(slot.firstAt, point.at)
    slot.lastAt = Math.max(slot.lastAt, point.at)
  }

  // 이을 공백의 크기를 데이터에서 정한다. 조회 간격을 바꿔도 따로 맞출 것이 없다.
  // 칸 수가 아니라 실제 시각으로 재는 이유는 창이 길면 한 칸이 열두 시간이나
  // 되기 때문이다. 칸으로 세면 그만한 공백도 붙어 있는 것으로 읽힌다.
  const step = medianStep(points)
  const bridgeMs = (step ?? 0) * GAP_FACTOR

  const values = new Array(columns).fill(null)
  let last = null
  for (let index = 0; index < columns; index += 1) {
    const slot = slots[index]
    if (slot == null) continue
    if (last != null && slot.firstAt - slots[last].lastAt <= bridgeMs) {
      for (let gap = last + 1; gap < index; gap += 1) values[gap] = slots[last].value
    }
    values[index] = slot.value
    last = index
  }
  return { values, from, to }
}

// 조회를 이만큼 거른 것까지는 이어 붙인다. 그 이상은 관측이 끊긴 것으로 본다.
const GAP_FACTOR = 3

/** 표본 간격의 중앙값. 어쩌다 길어진 한 구간에 끌려가지 않게 평균 대신 쓴다. */
function medianStep(points) {
  const steps = []
  for (let index = 1; index < points.length; index += 1) {
    const step = points[index].at - points[index - 1].at
    if (step > 0) steps.push(step)
  }
  if (steps.length === 0) return null
  steps.sort((a, b) => a - b)
  const mid = Math.floor(steps.length / 2)
  return steps.length % 2 ? steps[mid] : (steps[mid - 1] + steps[mid]) / 2
}

const levelOf = (series, key) => series
  .map((point) => ({ at: point.at, value: point[key] }))
  .filter((point) => typeof point.value === 'number')

/**
 * 표본 사이의 증가분을 시간당 %p 로 환산한다. 조회 간격이 흔들려도 비교할 수 있다.
 * 창이 리셋되면 값이 떨어지는데, 그건 소비가 아니라 초기화라 0 으로 본다.
 */
function rateOf(series, key) {
  const levels = levelOf(series, key)
  const out = []
  for (let index = 1; index < levels.length; index += 1) {
    const spanMs = levels[index].at - levels[index - 1].at
    if (spanMs <= 0) continue
    const delta = levels[index].value - levels[index - 1].value
    out.push({ at: levels[index].at, value: delta <= 0 ? 0 : (delta / spanMs) * HOUR_MS })
  }
  return out
}

export const pointsFor = (series, key, mode) => (mode === 'rate'
  ? rateOf(series, key)
  : levelOf(series, key))

/**
 * 그릴 창을 고른다. 소비 모드는 가장 짧은 창 하나만 쓴다.
 *
 * API 가 정수 %만 주기 때문이다. 7일 창은 2분 간격으로 거의 안 움직이다가
 * 어쩌다 1%p 오르는데, 그걸 시간당으로 환산하면 5시간 창과 같은 크기로 튄다.
 * 소비량이 아니라 양자화가 만든 계단이라 읽을 게 없다.
 */
export function keysForMode(keys, mode) {
  if (mode !== 'rate') return keys
  const short = keys.find((key) => key === '5h')
  return short ? [short] : keys.slice(0, 1)
}

/**
 * 그릴 시리즈를 만든다. 누적은 0~100 고정 축이라 계정을 바꿔도
 * 눈금이 흔들리지 않고, 소비는 값이 작아 관측 최댓값에 맞춘 자동 축을 쓴다.
 *
 * @returns {{series:number[][], keys:string[], min:number, max:number, from:number|null, to:number|null}}
 */
export function chartSeries(history, keys, columns, mode = 'level', rangeMs = null) {
  const range = windowRange(rangeMs)
  const folded = keys.map((key) =>
    resample(within(pointsFor(history, key, mode), range), columns, range))
  const observed = Math.max(0, ...folded.flatMap((entry) => entry.values.filter(isNumber)))
  return {
    series: folded.map((entry) => entry.values),
    keys,
    min: 0,
    max: mode === 'rate' ? niceCeiling(observed) : 100,
    from: Math.min(...folded.map((e) => e.from ?? Infinity)) || null,
    to: Math.max(...folded.map((e) => e.to ?? 0)) || null,
  }
}

/** 축 꼭대기를 1, 2, 5 의 배수로 올려 눈금 숫자가 읽기 좋게 떨어지게 한다. */
function niceCeiling(value) {
  if (!(value > 0)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude
  }
  return 10 * magnitude
}

/** 고른 기간을 지금 기준으로 잡는다. 기간을 안 주면 표본이 있는 만큼만 그린다. */
function windowRange(rangeMs) {
  if (!rangeMs) return null
  const to = Date.now()
  return { from: to - rangeMs, to }
}

/** 기간 밖 표본을 버린다. 남겨 두면 첫 칸에 몰려 축이 어긋난다. */
function within(points, range) {
  if (!range) return points
  return points.filter((point) => point.at >= range.from && point.at <= range.to)
}

/** 모든 계정 표본을 아우르는 시간 범위. 열을 맞춰야 계정끼리 평균이 선다. */
function spanOf(historyById, accounts) {
  const stamps = accounts.flatMap((account) => (historyById[account.id] ?? []).map((p) => p.at))
  return stamps.length ? { from: Math.min(...stamps), to: Math.max(...stamps) } : null
}

/**
 * 전체를 한 줄로 본다. 계정별로 쪼개지 않고 "쓴 양 / 전체 캐파" 를 그린다.
 *
 * 계정이 모두 같은 요금제면 캐파가 같으므로 계정 사용률의 평균이 곧 그 비율이다.
 * 요금제가 섞이면 이 평균은 근사다. 지금 이 맥의 계정은 넷 다 같은 등급이다.
 */
export function overviewSeries(historyById, accounts, keys, columns, mode = 'level', rangeMs = null) {
  const range = windowRange(rangeMs) ?? spanOf(historyById, accounts)
  if (!range) return { lines: [], min: 0, max: 100, from: null, to: null, latest: [] }

  const lines = []
  const latest = []
  for (const key of keys) {
    const perAccount = accounts
      .map((account) => resample(
        within(pointsFor(historyById[account.id] ?? [], key, mode), range), columns, range))
      .map((entry) => entry.values)
      .filter((values) => values.length === columns)
    if (perAccount.length === 0) {
      lines.push({ key, stat: 'avg', values: [] })
      latest.push(0)
      continue
    }
    // 그 칸을 관측한 계정끼리만 평균 낸다. 관측이 없는 계정을 0 으로 세면
    // 계정이 늦게 붙은 구간에서 전체가 실제보다 낮게 그려진다.
    const average = Array.from({ length: columns }, (_, column) => {
      let sum = 0
      let seen = 0
      for (const line of perAccount) {
        if (!isNumber(line[column])) continue
        sum += line[column]
        seen += 1
      }
      return seen ? sum / seen : null
    })
    lines.push({ key, stat: 'avg', values: average })
    latest.push([...average].reverse().find(isNumber) ?? 0)
  }

  const observed = Math.max(0, ...lines.flatMap((line) => line.values.filter(isNumber)))
  return {
    lines,
    min: 0,
    max: mode === 'rate' ? niceCeiling(observed) : 100,
    from: range.from,
    to: range.to,
    latest,
    accountCount: accounts.length,
  }
}
