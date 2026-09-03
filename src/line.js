// asciichart 와 같은 선 문자. 모양을 바꾸지 않으려고 그대로 가져왔다.
const FLAT = '─'
const FALL_HEAD = '╰'
const FALL_TAIL = '╮'
const RISE_HEAD = '╭'
const RISE_TAIL = '╯'
const VERTICAL = '│'

/**
 * 선 차트를 셀 격자로 만든다. areaGrid 와 같은 형태를 돌려주므로 축과 색은 한
 * 곳에서 그린다.
 *
 * asciichart 를 쓰지 않는 이유는 결측을 표현할 수 없어서다. 그쪽은 값이 없는
 * 칸에 null 을 주면 0 으로 찍고 NaN 을 주면 축 계산이 깨진다. 조회가 없던
 * 구간까지 바닥에 선이 그어지면 "안 썼다" 로 읽힌다. 여기서는 숫자가 아닌 칸을
 * 건너뛰어 그 자리를 비운다.
 *
 * @param {(number|null)[][]} series 시리즈별 열 값. 결측은 null
 * @param {number} min 축 바닥
 * @param {number} max 축 꼭대기
 * @param {number} height 줄 수
 * @returns {({char: string, index: number}|null)[][]} 위에서 아래로 쌓은 격자
 */
export function lineGrid(series, min, max, height) {
  const columns = Math.max(...series.map((line) => line.length), 0)
  const rows = Math.max(1, height - 1)
  const span = max - min || 1
  const rowOf = (value) => {
    const clamped = Math.min(max, Math.max(min, value))
    return rows - Math.round(((clamped - min) / span) * rows)
  }

  const grid = Array.from({ length: rows + 1 }, () => new Array(columns).fill(null))
  const put = (row, column, char, index) => {
    if (row < 0 || row > rows || column < 0 || column >= columns) return
    // 먼저 그린 시리즈를 남긴다. 뒤엣것이 덮으면 앞 선이 통째로 사라진다.
    if (grid[row][column] == null) grid[row][column] = { char, index }
  }

  series.forEach((line, index) => {
    for (let column = 0; column < columns; column += 1) {
      const value = line[column]
      if (typeof value !== 'number') continue
      const next = line[column + 1]
      const head = rowOf(value)
      // 다음 칸이 비었으면 이을 곳이 없다. 점을 찍어 표본이 있었다는 것만 남긴다.
      if (typeof next !== 'number') {
        put(head, column, FLAT, index)
        continue
      }
      const tail = rowOf(next)
      if (head === tail) {
        put(head, column, FLAT, index)
        continue
      }
      const falling = tail > head
      put(tail, column, falling ? FALL_HEAD : RISE_HEAD, index)
      put(head, column, falling ? FALL_TAIL : RISE_TAIL, index)
      for (let row = Math.min(head, tail) + 1; row < Math.max(head, tail); row += 1) {
        put(row, column, VERTICAL, index)
      }
    }
  })
  return grid
}
