// 터미널을 원래대로 돌려놓는 일을 모아 둔다.
//
// 대체 화면과 마우스 리포팅은 우리가 켠 것이라 우리가 꺼야 한다. 그런데 끄는
// 시점이 까다롭다. React 정리 단계에서 끄면 그 뒤에 ink 가 마지막 프레임을
// 원래 화면에 찍어 그것이 남고, process.on('exit') 에만 걸면 시그널로 죽을 때
// 그 핸들러가 돌지 않아 화면이 통째로 눌러붙는다. 그래서 프로세스가 끝나는
// 순간과 시그널 양쪽에 건다.
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']
// 셸이 쓰는 관례다. 시그널로 죽으면 128 에 시그널 번호를 더한다.
const SIGNAL_EXIT_CODE = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }

const pending = new Set()
let wired = false

function runAll() {
  for (const restore of pending) {
    try {
      restore()
    } catch { /* 나가는 길이다. 하나가 실패해도 나머지는 돌려놓는다 */ }
  }
  pending.clear()
}

function wire() {
  if (wired) return
  wired = true
  process.on('exit', runAll)
  for (const name of SIGNALS) {
    process.on(name, () => {
      runAll()
      process.exit(SIGNAL_EXIT_CODE[name] ?? 1)
    })
  }
}

/**
 * 프로세스가 끝날 때 부를 복원 함수를 건다.
 *
 * 한 번 걸면 떼지 않는다. React 정리 단계는 프로세스가 끝나기 전에 돌아서,
 * 거기서 떼면 정작 끝나는 순간에 돌려놓을 것이 남지 않는다. 두 번 돌려놓아도
 * 해가 없으므로 그냥 둔다.
 *
 * @param {() => void} restore
 */
export function restoreOnExit(restore) {
  wire()
  pending.add(restore)
}
