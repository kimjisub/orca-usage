import React from 'react'
import { Box, Text } from 'ink'
import { clockAt, shortSpan } from '../format.js'

// 종류마다 이름과 색. 이름은 넉 자로 맞춰 세로가 줄로 읽힌다.
const KIND = {
  poll: { label: '조회', color: 'gray' },
  token: { label: '토큰', color: 'cyan' },
  cycle: { label: '사이클', color: 'green' },
  switch: { label: '전환', color: 'yellow' },
  error: { label: '실패', color: 'red' },
}
const LABEL_WIDTH = 7

/**
 * 이 도구가 스스로 한 일의 기록.
 *
 * 알림은 8초 뒤 사라지고 자동 블록은 종류마다 마지막 하나만 보인다. "아까 왜
 * 계정이 바뀌었지" 는 지나고 나서 묻게 되므로 여기 남는다. 최신이 위다.
 */
export function Log({ entries, now, height, columns }) {
  if (entries.length === 0) {
    return <Text color="gray">{'아직 기록이 없습니다'}</Text>
  }
  // 제목 한 줄을 빼고 남는 만큼 그린다.
  const shown = entries.slice(0, Math.max(1, height - 1))
  const withDate = (at) => now - at > 12 * 3_600_000

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="white">{'제어 기록'}</Text>
        <Text color="gray">{`  최근 ${entries.length}건`}</Text>
      </Text>
      {shown.map((entry, index) => {
        const kind = KIND[entry.kind] ?? { label: entry.kind, color: 'gray' }
        return (
          <Text key={`${entry.at}-${index}`} wrap="truncate">
            <Text color="gray">{clockAt(entry.at, { withDate: withDate(entry.at) }).padEnd(6)}</Text>
            <Text color={kind.color}>{` ${kind.label.padEnd(LABEL_WIDTH - 1)}`}</Text>
            {entry.email ? <Text color="white">{`${entry.email.split('@')[0]}  `}</Text> : null}
            <Text color={entry.kind === 'error' || entry.ok === false ? 'red' : 'gray'}>{entry.text}</Text>
          </Text>
        )
      })}
    </Box>
  )
}
