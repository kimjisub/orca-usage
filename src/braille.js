// 점자 문자 한 글자는 세로 넷, 가로 둘, 점 여덟 개 격자다. 어느 점을 찍을지가
// 비트 하나씩이라 256 가지가 나온다. 글자 뜻과 무관하게 한 칸을 픽셀 여덟 개로
// 쓴다. btop 과 bottom 이 그래프 기본으로 쓰는 방식이다.
//
// 비트 배치는 유니코드 점자 표준이다. 왼쪽 열이 위에서부터 1, 2, 4, 64 이고
// 오른쪽 열이 8, 16, 32, 128 이다. 7 과 8 번 점이 뒤에 붙어 순서가 어긋난다.
const DOT_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]
const BRAILLE_BASE = 0x2800
export const DOTS_PER_CELL_X = 2
export const DOTS_PER_CELL_Y = 4

/**
 * 선 차트를 점자 격자로 만든다. lineGrid 와 같은 형태를 돌려주므로 축과 색은 한
 * 곳에서 그린다.
 *
 * 열 값은 칸 수의 두 배로 받는다. 한 칸이 가로 두 점이라 그만큼 표본을 더
 * 올릴 수 있다. 값이 없는 열은 비운다. 이웃한 두 점의 높이가 다르면 그 사이를
 * 세로로 채워 선이 끊기지 않게 한다.
 *
 * @param {(number|null)[][]} series 시리즈별 열 값. 길이는 칸 수의 두 배
 * @param {number} min 축 바닥
 * @param {number} max 축 꼭대기
 * @param {number} height 줄 수
 * @returns {({char: string, index: number}|null)[][]} 위에서 아래로 쌓은 격자
 */
export function brailleGrid(series, min, max, height) {
  const width = Math.max(...series.map((line) => line.length), 0)
  const columns = Math.ceil(width / DOTS_PER_CELL_X)
  const rows = Math.max(1, height)
  const pixelRows = rows * DOTS_PER_CELL_Y
  const span = max - min || 1
  // 값을 위에서부터 센 픽셀 행으로 옮긴다. 바닥 값이 마지막 픽셀 행에 온다.
  const pixelOf = (value) => {
    const clamped = Math.min(max, Math.max(min, value))
    return Math.round(((max - clamped) / span) * (pixelRows - 1))
  }

  const bits = Array.from({ length: rows }, () => new Uint8Array(columns))
  const owner = Array.from({ length: rows }, () => new Array(columns).fill(null))
  const plot = (x, py, index) => {
    if (x < 0 || x >= width || py < 0 || py >= pixelRows) return
    const column = Math.floor(x / DOTS_PER_CELL_X)
    const row = Math.floor(py / DOTS_PER_CELL_Y)
    bits[row][column] |= DOT_BITS[x % DOTS_PER_CELL_X][py % DOTS_PER_CELL_Y]
    // 먼저 그린 시리즈가 색을 가진다. 뒤엣것이 덮으면 앞 선이 통째로 사라진다.
    if (owner[row][column] == null) owner[row][column] = index
  }

  series.forEach((line, index) => {
    for (let x = 0; x < line.length; x += 1) {
      const value = line[x]
      if (typeof value !== 'number') continue
      const py = pixelOf(value)
      plot(x, py, index)
      const next = line[x + 1]
      if (typeof next !== 'number') continue
      // 다음 점까지 세로로 잇는다. 오르는 쪽은 다음 열에, 내리는 쪽은 이 열에
      // 채워야 꺾이는 자리가 한쪽으로 쏠리지 않는다.
      const to = pixelOf(next)
      if (to === py) continue
      const step = to > py ? 1 : -1
      const fillX = to > py ? x : x + 1
      for (let p = py + step; p !== to; p += step) plot(fillX, p, index)
    }
  })

  return bits.map((rowBits, row) => Array.from(rowBits, (value, column) => (
    value
      ? { char: String.fromCharCode(BRAILLE_BASE + value), index: owner[row][column] ?? 0 }
      : null
  )))
}
