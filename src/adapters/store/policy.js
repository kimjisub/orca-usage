import fs from 'node:fs'
import path from 'node:path'
import { STATE_DIR } from '../../paths.js'
import { writeJsonAtomic } from './store.js'

const POLICY_PATH = path.join(STATE_DIR, 'settings.json')

/**
 * 백엔드가 따르는 정책. 이 파일은 백엔드만 쓴다.
 *
 * 파일 이름은 예전 그대로 settings.json 이다. 화면이 쓰던 시절의 값
 * (autoSwitch, keepAlive, tuning, hiddenIds, lastSwitchAt)을 그대로 이어받기
 * 위해서다. 화면 상태였던 graphMode, rangeIndex, selectedId 는 읽지 않고,
 * 다음에 쓸 때 사라진다.
 */
export const POLICY_DEFAULTS = {
  autoSwitch: false,
  keepAlive: false,
  notifications: true,
  tuning: {},
  hiddenIds: [],
  lastSwitchAt: 0,
}

export function loadPolicy(file = POLICY_PATH) {
  let saved = {}
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8')) ?? {}
  } catch { /* 처음이거나 깨졌다. 기본값으로 시작한다 */ }
  // 손으로 고쳤거나 판이 바뀌었을 수 있다. 아는 키만, 타입이 맞을 때만 받는다.
  const policy = { ...POLICY_DEFAULTS }
  for (const [key, fallback] of Object.entries(POLICY_DEFAULTS)) {
    const value = saved[key]
    if (value !== undefined && typeof value === typeof fallback) policy[key] = value
  }
  policy.hiddenIds = Array.isArray(saved.hiddenIds)
    ? saved.hiddenIds.filter((id) => typeof id === 'string')
    : []
  if (!policy.tuning || Array.isArray(policy.tuning)) policy.tuning = {}
  return policy
}

export function savePolicy(policy, file = POLICY_PATH) {
  const next = {}
  for (const key of Object.keys(POLICY_DEFAULTS)) next[key] = policy[key]
  writeJsonAtomic(file, next, true)
}
