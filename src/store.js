import fs from 'node:fs'
import { CACHE_PATH, HISTORY_PATH, STATE_DIR } from './paths.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * 오래된 표본은 솎아 낸다.
 *
 * 한 달치를 2분 간격으로 다 들고 있으면 계정당 이만 개가 넘어 매 조회마다 읽고
 * 쓰는 비용이 커진다. 최근 하루는 조회한 그대로, 그 앞은 십 분, 더 앞은 한 시간
 * 간격으로 남긴다. 긴 기간을 볼 때는 어차피 한 칸이 몇십 분이라 해상도가 남는다.
 */
const KEEP_RULES = [
  { within: DAY, every: 0 },
  { within: 7 * DAY, every: 10 * MINUTE },
  { within: 31 * DAY, every: HOUR },
]

function compact(series, now) {
  const kept = []
  let lastAt = new Map()
  // 최근 것부터 훑어야 각 구간의 첫 표본이 기준점이 된다.
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const point = series[index]
    const age = now - point.at
    const rule = KEEP_RULES.find((entry) => age <= entry.within)
    if (!rule) break
    if (rule.every === 0) {
      kept.push(point)
      continue
    }
    const previous = lastAt.get(rule.within)
    if (previous == null || previous - point.at >= rule.every) {
      kept.push(point)
      lastAt.set(rule.within, point.at)
    }
  }
  return kept.reverse()
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value))
    fs.renameSync(tmp, file)
  } catch { /* 캐시를 못 써도 화면은 계속 그린다 */ }
}

export const loadCache = () => readJson(CACHE_PATH, {})
export const saveCache = (cache) => writeJson(CACHE_PATH, cache)
export const loadHistory = () => readJson(HISTORY_PATH, {})
export const saveHistory = (history) => writeJson(HISTORY_PATH, history)

/** 창별 사용률을 시각과 함께 쌓는다. 아래쪽 그래프가 이걸 읽는다. */
export function appendHistory(history, accountId, windows) {
  const series = history[accountId] ?? []
  const point = { at: Date.now() }
  for (const window of windows) point[window.label] = window.pct
  series.push(point)
  history[accountId] = compact(series, point.at)
  return history
}
