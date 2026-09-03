import React from 'react'
import { Text } from 'ink'
import { elapsedRatio, msUntil, shadeFor, shortSpan } from '../format.js'

const TRACK = '━'
const MARKER = '│'

/**
 * 사용률 막대. 창 안에서 시간이 어디까지 왔는지를 세로 막대로 겹쳐 찍는다.
 * 마커보다 채운 칸이 길면 앞서 쓰고 있다는 뜻이고, 그때 막대가 주황으로 바뀐다.
 *
 * 전체를 묶어 그릴 때는 계정마다 경과와 리셋이 달라 평균과 최단값을 미리 계산해
 * 넘긴다. 계정 하나를 그릴 때는 resetsAt 에서 직접 구한다.
 */
export function Bar({
  label, pct, resetsAt, width = 34, now,
  elapsed: elapsedProp, remaining: remainingProp, trailing, indent = 5,
  showRemaining = true,
}) {
  const filled = Math.min(width, Math.max(0, Math.round((pct / 100) * width)))
  const elapsed = elapsedProp ?? elapsedRatio(label, resetsAt, now)
  // 마커는 어느 막대에서든 경과한 시간이다. 전체와 계정별에서 뜻이 갈리면
  // 읽는 쪽이 매번 어느 쪽인지 판단해야 한다.
  const markerAt = elapsed == null ? -1 : Math.min(width - 1, Math.floor(elapsed * width))
  const shade = shadeFor(pct, elapsed)

  const cells = []
  for (let index = 0; index < width; index += 1) {
    const isMarker = index === markerAt
    const isFilled = index < filled
    cells.push(
      <Text
        key={index}
        color={isMarker ? 'white' : isFilled ? shade : 'blackBright'}
        bold={isMarker}
      >
        {isMarker ? MARKER : TRACK}
      </Text>,
    )
  }

  const remaining = remainingProp ?? msUntil(resetsAt, now)
  return (
    <Text wrap="truncate">
      {' '.repeat(indent)}
      <Text color="white">{label.padEnd(7)}</Text>
      {cells}
      <Text color={shade} bold>{`${String(Math.round(pct)).padStart(4)}%`}</Text>
      {/* 남은 시간 길이가 들쭉날쭉하면 뒤에 붙는 값의 자리가 매번 달라진다. */}
      {showRemaining
        ? <Text color="gray">{remaining == null ? ' '.repeat(9) : `  ${shortSpan(remaining).padStart(7)}`}</Text>
        : null}
      {trailing ? <Text color="gray">{trailing}</Text> : null}
    </Text>
  )
}
