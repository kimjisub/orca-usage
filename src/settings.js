import fs from 'node:fs'
import path from 'node:path'
import { STATE_DIR } from './paths.js'

const SETTINGS_PATH = path.join(STATE_DIR, 'settings.json')

/**
 * 화면 상태를 파일에 남긴다.
 *
 * 상시로 띄워 두는 도구라 재시작이 잦다. 매번 기간과 모드를 다시 고르게 하면
 * 켤 때마다 같은 손이 든다. 마지막 전환 시각도 함께 남긴다 — 이것을 잃으면
 * 앱을 껐다 켠 직후 쿨다운이 풀린 것처럼 보여 방금 옮긴 계정에서 또 옮긴다.
 */
const DEFAULTS = {
  graphMode: 'level',
  rangeIndex: 3,
  showModelWindows: true,
  showGraph: true,
  autoSwitch: false,
  selectedId: null,
  lastSwitchAt: 0,
}

export function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
    // 손으로 고쳤거나 판이 바뀌었을 수 있다. 아는 키만, 타입이 맞을 때만 받는다.
    const merged = { ...DEFAULTS }
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      const value = saved?.[key]
      if (value !== undefined && (fallback === null || typeof value === typeof fallback)) {
        merged[key] = value
      }
    }
    return merged
  } catch {
    return { ...DEFAULTS }
  }
}

let pending = null

/** 여러 상태가 한 번에 바뀌어도 파일 쓰기는 한 번만 한다. */
export function saveSettings(patch) {
  pending = { ...(pending ?? loadSettings()), ...patch }
  queueMicrotask(() => {
    if (!pending) return
    const next = pending
    pending = null
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true })
      const tmp = `${SETTINGS_PATH}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
      fs.renameSync(tmp, SETTINGS_PATH)
    } catch { /* 설정을 못 써도 화면은 계속 돈다 */ }
  })
}
