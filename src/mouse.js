import { useEffect } from 'react'

// SGR 마우스 리포팅. 1000 은 누름과 뗌, 1006 은 좌표를 열 번호로 받는 확장이라
// 80열을 넘는 화면에서도 자리가 어긋나지 않는다.
const ENABLE = '\u001B[?1000h\u001B[?1006h'
const DISABLE = '\u001B[?1000l\u001B[?1006l'
// ink 는 시퀀스를 넘겨줄 때 앞의 ESC 를 떼고 주는 경우가 있다. 터미널에
// 따라 붙은 채로도 오므로 ESC 는 있어도 없어도 맞게 둔다.
const SGR = /\u001B?\[<(\d+);(\d+);(\d+)([Mm])/

/** 마우스 리포팅을 켠다. 좌표는 useInput 이 문자열로 받아 오므로 여기서는 켜고 끄기만 한다. */
export function useMouseReporting(enabled = true) {
  useEffect(() => {
    if (!enabled || !process.stdin.isTTY) return undefined
    process.stdout.write(ENABLE)
    const restore = () => process.stdout.write(DISABLE)
    process.on('exit', restore)
    return () => {
      process.off('exit', restore)
      restore()
    }
  }, [enabled])
}

/** 입력이 마우스 리포팅 시퀀스인지 본다. 맞으면 키 입력으로 해석하지 않는다. */
export function isMouseSequence(input) {
  return SGR.test(input)
}

/**
 * 입력 문자열에서 클릭을 읽는다.
 *
 * stdin 에 리스너를 따로 붙여 처리하면 거기서 부른 setState 가 React 에 닿지
 * 않아 조용히 사라진다. ink 의 useInput 은 이 시퀀스를 그대로 넘겨주므로,
 * 컴포넌트 안에서 파싱하면 상태 갱신이 정상 경로를 탄다.
 *
 * 뗄 때만 클릭으로 본다. 누름과 뗌을 다 받으면 한 번 클릭이 두 번이 된다.
 *
 * @returns {{row: number, column: number} | null} 1 부터 세는 좌표
 */
export function parseMouseClick(input) {
  const match = SGR.exec(input)
  if (!match) return null
  const [, button, column, row, kind] = match
  if (kind !== 'm' || Number(button) !== 0) return null
  return { row: Number(row), column: Number(column) }
}
