import React from 'react'
import { Box, Text } from 'ink'
import { aggregateWindows, visibleWindows } from '../format.js'
import { Bar } from './Bar.jsx'

/** 제목 + 창 수 + 테두리. 좌측 위아래를 나눌 때 이 높이를 쓴다. */
export const totalBarsHeight = (windowCount) => windowCount + 3

/**
 * 계정 전체를 하나의 리소스로 본 슬라이더.
 *
 * 계정별 막대는 오른쪽 목록에 이미 있다. 여기서 답할 질문은 "우리가 가진 것을
 * 통틀어 얼마나 남았나" 하나다. 같은 이름의 창끼리 묶어 계정 수로 나눈 값이라,
 * 막대는 계정별 것과 같은 축에서 읽힌다.
 */
export function TotalBars({ rows, width, now, showModelWindows, selected }) {
  const visible = rows.map((row) => ({
    ...row,
    usage: row.usage
      ? { ...row.usage, windows: visibleWindows(row.usage.windows, showModelWindows) }
      : null,
  }))
  const windows = aggregateWindows(visible, now)
  // 들여쓰기 1, 라벨 7, 퍼센트 5, 사용량 7 을 뺀 나머지가 막대다. 범위 숫자는
  // 계정 점이 분포를 그대로 보여주므로 뺐다.
  const barWidth = Math.max(8, width - 20)

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="cyan" bold>{selected ? '>' : ' '}</Text>
        <Text color="white" bold>{' 전체 리소스'}</Text>
        <Text color="gray">{`   ${rows.length} 계정`}</Text>
      </Text>
      {windows.length === 0
        ? <Text color="gray">{'     아직 받은 사용량이 없습니다'}</Text>
        : windows.map((window) => (
          <Bar
            key={window.label}
            label={window.label}
            pct={window.pct}
            elapsed={window.elapsed}
            width={barWidth}
            now={now}
            indent={1}
            showRemaining={false}
            trailing={`  ${window.used.toFixed(1)}/${window.capacity}`}
          />
          ))}
      <Text> </Text>
    </Box>
  )
}
