// 아래에서 차오르는 부분 블록. 한 줄을 여덟 단계로 쪼개 세로 해상도를 높인다.
const PARTIAL = [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇']
const FULL = '█'

/**
 * 면 차트를 셀 격자로 만든다.
 *
 * 소비는 구간별로 태운 양이라 표본 사이에 값이 존재하지 않는다. 선으로 이으면
 * 없던 중간값을 만들어내므로, 각 구간을 바닥부터 채운 덩어리로 그린다. 면적이
 * 곧 총 소비량이라 눈으로 적분된다.
 *
 * 셀이 겹치면 그 칸을 채우는 시리즈 중 값이 가장 작은 것의 색을 쓴다. 그러면
 * 아래쪽은 작은 시리즈, 위쪽은 큰 시리즈 색이 되어 층이 드러난다.
 *
 * @param {number[][]} series 시리즈별 열 값
 * @param {number} max 축 꼭대기
 * @param {number} height 줄 수
 * @returns {({char: string, index: number}|null)[][]} 위에서 아래로 쌓은 격자
 */
export function areaGrid(series, max, height) {
  const columns = Math.max(...series.map((line) => line.length), 0)
  const ceiling = max > 0 ? max : 1

  const grid = []
  for (let row = 0; row < height; row += 1) {
    // 이 줄이 담당하는 구간을 바닥 기준으로 잡는다. 맨 아랫줄이 0 부터 1 칸이다.
    const floor = height - 1 - row
    const cells = []
    for (let column = 0; column < columns; column += 1) {
      let best = null
      series.forEach((line, index) => {
        const value = line[column]
        if (typeof value !== 'number') return
        const filled = (Math.min(ceiling, Math.max(0, value)) / ceiling) * height
        let char
        if (filled >= floor + 1) {
          char = FULL
        } else if (filled > floor) {
          char = PARTIAL[Math.max(1, Math.round((filled - floor) * PARTIAL.length))] ?? FULL
        } else if (floor === 0) {
          // 값이 0 이어도 표본이 있었다는 것은 바닥에 남긴다. 아무것도 안 그리면
          // 그 시간에 안 썼다는 것과 조회가 끊겼다는 것이 구분되지 않는다.
          char = PARTIAL[1]
        } else {
          return
        }
        // 값이 작은 시리즈를 앞에 세워 층이 보이게 한다.
        if (best == null || value < best.value) best = { char, index, value }
      })
      cells.push(best ? { char: best.char, index: best.index } : null)
    }
    grid.push(cells)
  }
  return grid
}
