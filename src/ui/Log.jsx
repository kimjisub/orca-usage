import React from 'react'
import { Box, Text } from 'ink'
import { cellWidth, clockAt } from '../core/format.js'

// 종류마다 이름과 색. 이름 칸을 맞춰 세로가 줄로 읽힌다.
const KIND = {
  poll: { label: '사용량 조회', color: 'gray' },
  token: { label: '토큰', color: 'cyan' },
  cycle: { label: '창 열기', color: 'green' },
  switch: { label: '전환', color: 'yellow' },
  reset: { label: '리셋', color: 'magenta' },
  error: { label: '실패', color: 'red' },
}
// 가장 긴 이름(사용량 조회)이 열한 칸이다. 한글은 두 칸이라 padEnd 로는 안 맞는다.
const LABEL_WIDTH = 13
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))

/** 제목 한 줄을 빼고 목록에 돌아가는 줄 수. 스크롤 한계를 재는 쪽과 같은 값을 쓴다. */
export const logVisibleRows = (height) => Math.max(1, height - 1)

/**
 * 이 도구가 스스로 한 일의 기록.
 *
 * 알림은 8초 뒤 사라지고 자동 블록은 종류마다 마지막 하나만 보인다. "아까 왜
 * 계정이 바뀌었지" 는 지나고 나서 묻게 되므로 여기 남는다. 최신이 위다.
 *
 * 500건을 들고 있는데 화면에는 스무 줄 남짓만 들어간다. 위아래로 굴려 지난
 * 것까지 본다. offset 은 맨 위에 놓을 항목의 자리이고 0 이 최신이다.
 */
/**
 * 종류 칸에 이미 적힌 말은 본문에서 뺀다. "창 열기 | 창 열기", "토큰 | 토큰 갱신" 처럼
 * 같은 말이 두 번 읽힌다. 기록 파일의 문장은 그대로 둔다. CLI 와 알림은 종류 칸
 * 없이 그 문장만 보여 주기 때문이다.
 */
function bodyOf(text, label) {
  if (text === label) return ''
  for (const lead of [`${label}: `, `${label} `]) {
    if (text.startsWith(lead)) return text.slice(lead.length)
  }
  return text
}

export function Log({ entries, now, offset = 0, height, columns }) {
  if (entries.length === 0) {
    return <Text color="gray">{'기록 없음'}</Text>
  }
  const rows = logVisibleRows(height)
  // 기록이 쌓이거나 창이 커지면 보던 자리가 목록 밖으로 나갈 수 있다.
  const start = Math.min(Math.max(0, offset), Math.max(0, entries.length - rows))
  const shown = entries.slice(start, start + rows)
  const withDate = (at) => now - at > 12 * 3_600_000

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="white">{'동작 기록'}</Text>
        <Text color="gray">{`  최근 ${entries.length}건`}</Text>
        {/* 어디쯤 보고 있는지. 다 들어가면 굴릴 것이 없으므로 적지 않는다. */}
        {entries.length > rows
          ? <Text color="cyan">{`  ${start + 1}-${start + shown.length}`}</Text>
          : null}
      </Text>
      {shown.map((entry, index) => {
        const kind = KIND[entry.kind] ?? { label: entry.kind, color: 'gray' }
        return (
          <Text key={`${entry.at}-${index}`} wrap="truncate">
            <Text color="gray">{clockAt(entry.at, { withDate: withDate(entry.at) }).padEnd(6)}</Text>
            <Text color={kind.color}>{` ${pad(kind.label, LABEL_WIDTH - 1)}`}</Text>
            {entry.email ? <Text color="white">{`${entry.email.split('@')[0]}  `}</Text> : null}
            <Text color={entry.kind === 'error' || entry.ok === false ? 'red' : 'gray'}>{bodyOf(entry.text, kind.label)}</Text>
          </Text>
        )
      })}
    </Box>
  )
}
