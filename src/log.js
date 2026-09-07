import fs from 'node:fs'
import path from 'node:path'
import { STATE_DIR } from './paths.js'
import { writeJsonAtomic } from './store.js'
import { tuning } from './tuning.js'

const LOG_PATH = path.join(STATE_DIR, 'log.json')


/**
 * 이 도구가 스스로 한 일의 기록.
 *
 * 알림은 8초 뒤 사라지고 자동 블록은 마지막 하나만 보인다. 왜 계정이 바뀌었는지,
 * 언제 토큰을 돌렸는지는 지나고 나서 묻게 되므로 남긴다. 조회처럼 2분마다 도는
 * 것은 결과가 달라졌을 때만 적는다. 같은 줄로 목록을 채우면 나머지가 안 보인다.
 *
 * 종류(kind)는 화면에서 색과 이름으로 갈린다.
 *   poll     사용량 조회
 *   token    OAuth 토큰 갱신
 *   cycle    5h 창 사이클 트리거
 *   switch   계정 전환. 자동과 수동을 both 로 구분한다
 *   error    위 어느 것이든 실패
 */
let entries = null

function load() {
  if (entries) return entries
  try {
    const saved = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'))
    entries = Array.isArray(saved) ? saved.slice(-tuning().logKeep) : []
  } catch {
    entries = []
  }
  return entries
}

let pending = false
function flush() {
  if (pending) return
  pending = true
  // 한 폴링에서 여러 줄이 쌓인다. 줄마다 쓰면 파일을 그만큼 다시 쓴다.
  queueMicrotask(() => {
    pending = false
    try {
      writeJsonAtomic(LOG_PATH, entries ?? [])
    } catch { /* 기록을 못 남겨도 화면은 계속 돈다 */ }
  })
}

/**
 * 한 줄 남긴다.
 *
 * @param {'poll'|'token'|'cycle'|'switch'|'error'} kind
 * @param {string} text 무엇을 했는지. 계정 이름은 email 로 따로 넘긴다
 * @param {{email?: string, ok?: boolean}} [detail]
 */
export function log(kind, text, detail = {}) {
  const list = load()
  list.push({ at: Date.now(), kind, text, ...detail })
  const keep = tuning().logKeep
  if (list.length > keep) list.splice(0, list.length - keep)
  flush()
  return list
}

/** 최근 것부터. 화면은 위가 최신이다. */
export function loadLog() {
  return [...load()].reverse()
}
