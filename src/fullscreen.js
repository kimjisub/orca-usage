import { useEffect, useState } from 'react'

// 대체 화면 버퍼. 들어가면 원래 스크롤백을 덮지 않고, 나오면 그대로 복원된다.
const ENTER = '\u001B[?1049h\u001B[H'
const LEAVE = '\u001B[?1049l'
const HIDE_CURSOR = '\u001B[?25l'
const SHOW_CURSOR = '\u001B[?25h'

/** 전체 화면으로 들어가고, 터미널 크기를 계속 따라간다. */
export function useFullscreen(enabled = true) {
  const [size, setSize] = useState(() => ({
    columns: Math.max(60, process.stdout.columns || 100),
    rows: Math.max(20, process.stdout.rows || 40),
  }))

  useEffect(() => {
    if (!enabled || !process.stdout.isTTY) return undefined
    process.stdout.write(ENTER + HIDE_CURSOR)

    const onResize = () => setSize({
      columns: Math.max(60, process.stdout.columns || 100),
      rows: Math.max(20, process.stdout.rows || 40),
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
