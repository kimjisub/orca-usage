import React from 'react'
import { Box, Text } from 'ink'
import { cellWidth } from '../format.js'
import { TUNABLES, TUNING_DEFAULTS, formatTuning } from '../tuning.js'

// 한글은 두 칸이라 padEnd 로는 자리가 안 맞는다.
const LABEL_WIDTH = 15
const VALUE_WIDTH = 8
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))
const padStart = (text, width) => ' '.repeat(Math.max(0, width - cellWidth(text))) + text

/**
 * 판단 기준을 고치는 화면.
 *
 * 측정된 사실과 서버에 대한 예의는 여기 없다. 5시간 창을 채우면 주간이 20%p
 * 오른다는 것이나 요청 사이 간격 같은 것은 사람이 정할 값이 아니다. 여기 있는
 * 것은 "언제부터 위험으로 볼까" 처럼 쓰는 사람에 따라 갈리는 것뿐이다.
 */
// 라벨과 값, 그리고 힌트가 읽힐 만큼. 이보다 좁으면 힌트를 접고 고른 줄의
// 것만 아래에 따로 적는다. 줄마다 잘린 문장이 늘어서면 아무것도 안 읽힌다.
const HINT_WIDTH = LABEL_WIDTH + VALUE_WIDTH + 26

export function Settings({ values, selected, height, columns }) {
  const inlineHint = columns >= HINT_WIDTH
  const shown = TUNABLES.slice(0, Math.max(1, height - 2))
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="white">{'설정'}</Text>
        <Text color="gray">{'  위아래로 고르고 좌우로 바꿉니다'}</Text>
      </Text>
      {shown.map((item, index) => {
        const on = index === selected
        const value = values[item.key]
        const changed = value !== TUNING_DEFAULTS[item.key]
        return (
          <Text key={item.key} wrap="truncate">
            <Text color="cyan" bold>{on ? '> ' : '  '}</Text>
            <Text color={on ? 'white' : 'gray'}>{pad(item.label, LABEL_WIDTH - 2)}</Text>
            {/* 기본값에서 바뀐 것은 색으로 표시한다. 무엇을 건드렸는지 한눈에 보인다. */}
            <Text color={changed ? 'yellow' : 'white'} bold>
              {padStart(formatTuning(item, value), VALUE_WIDTH)}
            </Text>
            {inlineHint ? <Text color="gray">{`  ${item.hint}`}</Text> : null}
          </Text>
        )
      })}
      {inlineHint
        ? null
        : <Text color="gray" wrap="truncate">{`  ${TUNABLES[selected]?.hint ?? ''}`}</Text>}
      <Text color="gray" wrap="truncate">{'  0 을 누르면 기본값으로 돌아갑니다'}</Text>
    </Box>
  )
}
