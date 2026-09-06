import { useEffect, useState } from 'react'

// 대체 화면 버퍼. 들어가면 원래 스크롤백을 덮지 않고, 나오면 그대로 복원된다.
const ENTER = '\u001B[?1049h\u001B[H'
const LEAVE = '\u001B[?1049l'
const HIDE_CURSOR = '\u001B[?25l'
const SHOW_CURSOR = '\u001B[?25h'

// 실제 화면보다 크게 잡으면 그 폭으로 그리다 터미널이 줄을 접어 오히려 더
// 무너진다. 하한은 레이아웃이 최소한의 모양을 유지하는 크기까지만 둔다.
const MIN_COLUMNS = 40
const MIN_ROWS = 10

/** 전체 화면으로 들어가고, 터미널 크기를 계속 따라간다. */
export function useFullscreen(enabled = true) {
  const [size, setSize] = useState(() => ({
    columns: Math.max(MIN_COLUMNS, process.stdout.columns || 100),
    rows: Math.max(MIN_ROWS, process.stdout.rows || 40),
  }))

  useEffect(() => {
    if (!enabled || !process.stdout.isTTY) return undefined
    process.stdout.write(ENTER + HIDE_CURSOR)

    const onResize = () => setSize({
      columns: Math.max(MIN_COLUMNS, process.stdout.columns || 100),
      rows: Math.max(MIN_ROWS, process.stdout.rows || 40),
    })
    process.stdout.on('resize', onResize)

    const restore = () => process.stdout.write(SHOW_CURSOR + LEAVE)
    process.on('exit', restore)
    return () => {
      process.stdout.off('resize', onResize)
      process.off('exit', restore)
      restore()
    }
  }, [enabled])

  return size
}
