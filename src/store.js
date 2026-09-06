import fs from 'node:fs'
import path from 'node:path'
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
  const taken = new Set()
  // 최근 것부터 훑는다. 같은 칸에 여럿이면 먼저 만나는 최근 것이 남는다.
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const point = series[index]
    const age = now - point.at
    const rule = KEEP_RULES.find((entry) => age <= entry.within)
    if (!rule) break
    if (rule.every === 0) {
      kept.push(point)
      continue
    }
    // 시각을 고정 격자에 붙인다. 최근 표본을 기준으로 간격을 재면 표본이 올 때마다
    // 기준이 밀려 바로 앞의 것이 격자 안으로 들어오고, 그래서 하루를 넘긴 표본이
    // 두엇 말고는 남지 않았다. 실측 2026-09-06: 10일치를 2분 간격으로 넣었더니
    // 하루 밖에는 2개, 이레 밖에는 0개였다.
    const slot = `${rule.within}:${Math.floor(point.at / rule.every)}`
    if (!taken.has(slot)) {
      taken.add(slot)
      kept.push(point)
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

/**
 * 임시 파일에 쓰고 이름을 바꾼다. 임시 이름은 프로세스마다 다르다. 대시보드 옆에서
 * --once 를 돌리면 둘이 같은 임시 파일을 열어 서로의 쓰기를 자르고, 깨진 JSON 이
 * 제자리에 들어가면 다음 읽기가 빈 객체로 시작해 표본을 전부 잃는다.
 */
export function writeJsonAtomic(file, value, pretty = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  try {
    fs.writeFileSync(tmp, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value))
    fs.renameSync(tmp, file)
  } catch (error) {
    fs.rmSync(tmp, { force: true })
    throw error
  }
}

function writeJson(file, value) {
  try {
    writeJsonAtomic(file, value)
  } catch { /* 캐시를 못 써도 화면은 계속 그린다 */ }
}

export const loadCache = () => readJson(CACHE_PATH, {})
export const saveCache = (cache) => writeJson(CACHE_PATH, cache)
export const loadHistory = () => readJson(HISTORY_PATH, {})
export const saveHistory = (history) => writeJson(HISTORY_PATH, history)

/** 창별 사용률을 시각과 함께 쌓는다. 아래쪽 그래프가 이걸 읽는다. */
export function appendHistory(history, accountId, windows, at = Date.now()) {
  const series = history[accountId] ?? []
  // 같은 시각의 표본은 다시 넣지 않는다. Orca 가 갱신을 미룬 동안 같은 값을 매
  // 폴링 새 표본으로 쌓으면 아무도 관측하지 않은 시간에 평평한 선이 그어진다.
  if (series.length && series.at(-1).at === at) return history
  const point = { at }
  for (const window of windows) point[window.label] = window.pct
  series.push(point)
  history[accountId] = compact(series, point.at)
  return history
}
