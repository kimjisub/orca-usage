import { execFile } from 'node:child_process'

/** AppleScript 문자열 안에 넣을 수 있게 바꾼다. 따옴표와 역슬래시가 문법을 깬다. */
const quote = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * 알림센터에 한 줄 띄운다.
 *
 * launchd 에이전트는 로그인 세션(gui 도메인)에서 돌아 osascript 가 알림을 띄울
 * 수 있다. 실패해도 백엔드의 일은 계속돼야 하므로 결과를 기다리지 않고 오류도
 * 삼킨다.
 */
export function notify(title, body) {
  const script = `display notification ${quote(body)} with title ${quote(title)}`
  execFile('/usr/bin/osascript', ['-e', script], { timeout: 10_000 }, () => {})
}
