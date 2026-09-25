import React from 'react'
import { Box, Text } from 'ink'
import { aggregateWindows } from '../core/format.js'
import { Bar } from './Bar.jsx'

/**
 * 이 블록이 차지하는 줄 수. 제목, 창마다 한 줄(없으면 안내 한 줄), 빈 줄.
 * 목록이 화면에 몇 계정 들어가는지 잴 때 쓴다. 렌더와 같은 규칙으로 세지
 * 않으면 예산이 어긋나 아래 추천이 잘린다.
 */
export function totalBarsHeight(rows) {
  const labels = new Set()
  for (const row of rows) {
    for (const window of row.usage?.windows ?? []) labels.add(window.label)
  }
  return 1 + (labels.size || 1) + 1
}

/**
 * provider 하나의 계정을 통틀어 본 슬라이더. 그 provider 의 계정 목록 바로 위에
 * 선다.
 *
 * 계정별 막대는 아래에 이미 있다. 여기서 답할 질문은 "우리가 가진 것을 통틀어
 * 얼마나 남았나" 하나다. 같은 이름의 창끼리 묶어 계정 수로 나눈 값이라, 막대는
 * 계정별 것과 같은 축에서 읽힌다.
 *
 * Claude 와 Codex 를 한 막대에 담지 않는다. 창 구조가 달라 Claude 는 5h 와 7d
 * 를, Codex 는 7d 만 보고한다. 라벨이 같은 7d 끼리 평균을 내면 두 provider 의
 * 서로 다른 한도가 한 자원으로 합쳐져 분모부터 틀린다.
 */
export function TotalBars({ rows, label, width, now, selected }) {
  const windows = aggregateWindows(rows, now)
  // 들여쓰기 1, 라벨 7, 퍼센트 5, 사용량 7 을 뺀 나머지가 막대다.
  const barWidth = Math.max(8, width - 20)

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="cyan" bold>{selected ? '>' : ' '}</Text>
        <Text color="white" bold>{` ${label}`}</Text>
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
