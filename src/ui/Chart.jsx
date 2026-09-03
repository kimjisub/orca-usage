import React from 'react'
import { Text } from 'ink'
import { areaGrid } from '../area.js'
import { lineGrid } from '../line.js'
import { clockAt } from '../format.js'

const TICK_WIDTH = 4
// 한 줄의 왼쪽은 눈금 네 자리와 공백, 축 문자가 차지한다. 나머지가 데이터 폭이다.
export const AXIS_WIDTH = TICK_WIDTH + 2

const isNumber = (value) => typeof value === 'number'

const formatTick = (value) => String(Math.round(value)).padStart(TICK_WIDTH)
const BLANK_TICK = ' '.repeat(TICK_WIDTH)

/**
 * 눈금을 찍을 행과 거기 쓸 값.
 *
 * 행에 걸린 실제 값을 그대로 쓰면 74, 47, 26 처럼 어중간해진다. 스무 줄에
 * 75% 가 정확히 떨어지는 행이 없기 때문이다. 그래서 가장 가까운 행에 목표값을
 * 적는다. 한두 칸 오차가 나지만 차트 자체가 셀 단위 근사고, 읽는 쪽에는
 * 100 / 75 / 50 / 25 / 0 이 훨씬 빨리 들어온다.
 */
function tickMarks(rows, min, max, wanted = 5) {
  // 줄이 다섯도 안 되면 눈금 다섯 개가 같은 행에 겹쳐 100, 75, 25 처럼 빠진 채로
  // 찍힌다. 줄 수를 넘지 않게 잡는다.
  const count = Math.max(2, Math.min(wanted, rows))
  const marks = new Map()
  for (let index = 0; index < count; index += 1) {
    const ratio = index / (count - 1)
    marks.set(Math.round((1 - ratio) * (rows - 1)), min + ratio * (max - min))
  }
  return marks
}

/**
 * 격자의 축. 두 모드가 같은 배치를 쓰므로 모드를 바꿔도 눈금 자리가 그대로다.
 */
function axisLabel(row, height, max, marks) {
  const edge = row === 0 || row === height - 1
  const label = marks.has(row) ? formatTick(marks.get(row)) : BLANK_TICK
  return `${label} ${edge ? '┼' : '┤'}`
}

/**
 * 누적은 선, 소비는 면으로 그린다.
 *
 * 누적은 그 시점에 실제로 존재한 수준이라 표본 사이를 이어도 거짓이 아니다.
 * 소비는 구간에 태운 양이라 사이에 값이 없다. 선으로 이으면 0 과 60 사이를
 * 사선으로 메워 없던 중간값을 만들므로, 바닥부터 채운 덩어리로 그린다.
 *
 * 둘 다 격자로 만들어 한 경로로 그린다. 값이 없는 칸은 어느 쪽이든 비운다.
 */
export function Chart({ series, colors, min, max, height, mode, from, to, showAxis = true }) {
  const drawn = Math.max(...series.map((line) => line.length), 0)
  if (drawn === 0 || !series.some((line) => line.some(isNumber))) return null

  // 경과 시간이 아니라 날짜가 바뀌었는지를 본다. 어제 저녁부터 오늘 아침까지는
  // 열아홉 시간이지만 그 사이에 날이 넘어간다.
  const spansDay = Boolean(from && to)
    && new Date(from).toDateString() !== new Date(to).toDateString()
  const stamp = (value) => (value ? clockAt(value, { withDate: spansDay }) : '')
  const gap = Math.max(1, drawn - (spansDay ? 20 : 10))
  const timeAxis = showAxis
    ? (
      <Text color="gray" wrap="truncate">
        {`${' '.repeat(AXIS_WIDTH)}${stamp(from)}${' '.repeat(gap)}${stamp(to)}`}
      </Text>
      )
    : null

  const grid = mode === 'rate'
    ? areaGrid(series, max, height)
    : lineGrid(series, min, max, height)
  const marks = tickMarks(height, min, max)
  return (
    <>
      {grid.map((cells, row) => (
        <Text key={row} wrap="truncate">
          <Text color="gray">{axisLabel(row, height, max, marks)}</Text>
          {cells.map((cell, column) => (
            <Text key={column} color={cell ? colors[cell.index] : undefined}>
              {cell ? cell.char : ' '}
            </Text>
          ))}
        </Text>
      ))}
      {timeAxis}
    </>
  )
}
