import React from 'react'
import { Box, Text } from 'ink'
import { cellWidth } from '../core/format.js'
import { TUNABLES, TUNING_DEFAULTS, formatTuning } from '../core/tuning.js'

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

/**
 * 설정 화면의 줄. 판단 기준 뒤에 켜고 끄는 정책이 온다. 켜고 끄는 줄은 좌우로
 * 뒤집고 0 으로 기본값(켜짐)에 돌린다.
 */
export const SETTINGS_ROWS = [
  ...TUNABLES,
  {
    key: 'notifications',
    label: '알림',
    toggle: true,
    fallback: true,
    hint: '계정 전환과 재로그인 필요 시 macOS 알림',
  },
]

// 설명을 줄 옆에 붙이려면 가장 긴 설명까지 다 들어가야 한다. 모자라면 설명을
// 접고 고른 줄의 것만 아래에 따로 적는다. 줄마다 잘린 문장이 늘어서면 아무것도
// 안 읽힌다.
const HINT_WIDTH = LABEL_WIDTH + VALUE_WIDTH + 2
  + Math.max(...SETTINGS_ROWS.map((row) => cellWidth(row.hint)))

export function Settings({ values, policy, selected, editing = false, height, columns }) {
  const inlineHint = columns >= HINT_WIDTH
  // 머리글, 설명을 접었으면 그 한 줄을 뺀 만큼 항목이 선다. 넘치면
  // 고른 항목이 보이도록 창을 민다.
  const room = Math.max(1, height - 1 - (inlineHint ? 0 : 1))
  const start = Math.max(0, Math.min(selected - Math.floor(room / 2), SETTINGS_ROWS.length - room))
  const shown = SETTINGS_ROWS.slice(start, start + room)
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="white">{'설정'}</Text>
        {/* 좌우는 패널을 옮기는 키이기도 하다. 지금 어느 쪽으로 가는지 적는다. */}
        {editing ? <Text color="yellow" bold>{'  수정 중'}</Text> : null}
      </Text>
      {shown.map((item, offset) => {
        const on = start + offset === selected
        const value = item.toggle ? policy?.[item.key] : values[item.key]
        const changed = item.toggle ? value !== item.fallback : value !== TUNING_DEFAULTS[item.key]
        const shownValue = item.toggle ? (value ? '켜짐' : '꺼짐') : formatTuning(item, value)
        return (
          <Text key={item.key} wrap="truncate">
            <Text color={on && editing ? 'yellow' : 'cyan'} bold>{on ? '> ' : '  '}</Text>
            <Text color={on ? 'white' : 'gray'}>{pad(item.label, LABEL_WIDTH - 2)}</Text>
            {/* 기본값에서 바뀐 것은 색으로 표시한다. 무엇을 건드렸는지 한눈에 보인다.
                고치는 중인 값은 뒤집어 어느 것이 움직이는지 가린다. */}
            <Text color={changed ? 'yellow' : 'white'} bold inverse={on && editing}>
              {padStart(shownValue, VALUE_WIDTH)}
            </Text>
            {inlineHint ? <Text color="gray">{`  ${item.hint}`}</Text> : null}
          </Text>
        )
      })}
      {inlineHint
        ? null
        : <Text color="gray" wrap="truncate">{`  ${SETTINGS_ROWS[selected]?.hint ?? ''}`}</Text>}
    </Box>
  )
}
