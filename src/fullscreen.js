import { useEffect, useState } from 'react'
import { restoreOnExit } from './terminal.js'

// 대체 화면 버퍼. 들어가면 원래 스크롤백을 덮지 않고, 나오면 그대로 복원된다.
const ENTER = '\u001B[?1049h\u001B[H'
const LEAVE = '\u001B[?1049l'
const HIDE_CURSOR = '\u001B[?25l'
const SHOW_CURSOR = '\u001B[?25h'

// 실제 화면보다 크게 잡으면 그 폭으로 그리다 터미널이 줄을 접어 오히려 더
// 무너진다. 하한은 레이아웃이 최소한의 모양을 유지하는 크기까지만 둔다.
const MIN_COLUMNS = 40
const MIN_ROWS = 10

const measure = () => ({
  columns: Math.max(MIN_COLUMNS, process.stdout.columns || 100),
  rows: Math.max(MIN_ROWS, process.stdout.rows || 40),
})

/** 전체 화면으로 들어가고, 터미널 크기를 계속 따라간다. */
export function useFullscreen(enabled = true) {
  const [size, setSize] = useState(measure)

  useEffect(() => {
    if (!enabled || !process.stdout.isTTY) return undefined
    process.stdout.write(ENTER + HIDE_CURSOR)

    const onResize = () => setSize(measure())
    process.stdout.on('resize', onResize)

    // 복원은 프로세스가 끝나는 순간에 한다. React 정리 단계에서 미리 대체 화면을
    // 나가면 그 뒤에 ink 가 마지막 프레임을 원래 화면에 찍고 그것이 남는다.
    // 등록은 떼지 않는다. unmount 는 프로세스가 끝나기 전에 도는데 거기서 떼면
    // 정작 끝나는 순간에 돌려놓을 것이 남지 않는다.
    restoreOnExit(() => process.stdout.write(SHOW_CURSOR + LEAVE))
    return () => {
      process.stdout.off('resize', onResize)
    }
  }, [enabled])

  return size
}
