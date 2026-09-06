import React from 'react'
import { Box, Text } from 'ink'
import { buildSchedule } from '../schedule.js'
import { clockAt } from '../format.js'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const HOUR_AXIS = '0  2  4  6  8 10 12 14 16 18 20 22'
// 행 라벨 폭. 요일과 "오늘" 표시, 계정 번호와 이름 앞부분이 여기 든다.
const LABEL_WIDTH = 9
// 계정 이름 옆에 풀리는 시각까지 적으려면 이만큼은 있어야 한다.
const TAG_WIDTH = 22

// 가용 구간과 글자. 위에서부터 첫 매치. 0 은 아래에서 따로 그린다.
const SHADES = [
  { min: 75, char: '█', color: 'green' },
  { min: 50, char: '▓', color: 'green' },
  { min: 25, char: '▒', color: 'yellow' },
  { min: 0.5, char: '░', color: '#ff9f0a' },
]

/** 한 시간 한 칸. 값이 없으면(지난 시간) 비우고, 전부 막힘은 빨간 바탕이다. */
function Cell({ avail, spurt }) {
  if (avail == null) return <Text> </Text>
  if (spurt) return <Text color="yellow" bold>{'!'}</Text>
  const shade = SHADES.find((entry) => avail >= entry.min)
  if (!shade) return <Text backgroundColor="red">{' '}</Text>
  return <Text color={shade.color}>{shade.char}</Text>
}

function Row({ label, cells, tag }) {
  return (
    <Text wrap="truncate">
      {/* 라벨이 폭을 넘으면 그 줄의 칸이 밀려 시간축과 어긋난다. 자른다. */}
      <Text color="gray">{label.slice(0, LABEL_WIDTH - 1).padEnd(LABEL_WIDTH)}</Text>
      {cells.map((cell, hour) => (
        <Cell key={hour} avail={cell?.avail ?? cell} spurt={cell?.spurt} />
      ))}
      {tag ? <Text color="gray">{`  ${tag}`}</Text> : null}
    </Text>
  )
}

/**
 * 세로에 맞춰 무엇을 그릴지 정한다. 제목과 시간축 두 줄, 요일 일곱 줄, 범례 한
 * 줄이 기본이고 자리가 남으면 오늘 계정별 행을 붙인다. 그것도 모자라면 요일을
 * 앞에서부터 줄인다. 오늘부터 순서라 잘리는 것은 먼 날이다.
 */
function plan(height, accountCount) {
  const week = 2 + 7
  const today = 2 + accountCount
  const legend = 1
  if (height >= week + today + legend) return { days: 7, today: true }
  if (height >= week + legend) return { days: 7, today: false }
  return { days: Math.max(1, height - 2 - legend), today: false }
}

/**
 * 앞으로 7일 중 언제 일할 수 있고 언제 막히나.
 *
 * 일주일 격자는 계정을 합쳐 본다. 어느 계정이든 열려 있으면 일할 수 있다.
 * 오늘 행은 계정마다 따로다. 지금 어느 계정이 막혔고 언제 풀리는지는 합치면
 * 사라진다.
 */
export function Schedule({ rows, historyById, now, height, columns }) {
  const schedule = buildSchedule(rows, historyById, now)
  if (!schedule) return <Text color="gray">{'표본이 쌓이면 여기에 그려집니다'}</Text>

  const shown = plan(height, schedule.today.length)
  const wideEnough = columns >= LABEL_WIDTH + 24 + TAG_WIDTH
  const basis = schedule.hasBurn ? '관측 속도로 예측' : '예측 없음, 리셋만'

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="white">{'전체 일정'}</Text>
        <Text color="gray">{`  앞으로 7일  ${basis}`}</Text>
      </Text>
      <Text color="gray" wrap="truncate">{`${' '.repeat(LABEL_WIDTH)}${HOUR_AXIS}`}</Text>
      {schedule.days.slice(0, shown.days).map((day) => (
        <Row
          key={day.weekday + (day.today ? 't' : '')}
          label={`${WEEKDAYS[day.weekday]}${day.today ? ' 오늘' : ''}`}
          cells={day.cells}
        />
      ))}
      {shown.today
        ? (
          <>
            <Text> </Text>
            <Text color="white" wrap="truncate">{'오늘 계정별'}</Text>
            {schedule.today.map((account) => (
              <Row
                key={account.index}
                label={`${account.index} ${account.email.split('@')[0]}`}
                cells={account.cells}
                tag={wideEnough && account.blockedUntil
                  ? `5h ${Math.round(account.shortPct)}%, ${clockAt(account.blockedUntil)} 풀림`
                  : null}
              />
            ))}
          </>
          )
        : null}
      <Text color="gray" wrap="truncate">
        {'█ 75%+  ▓ 50  ▒ 25  ░ 0~25  '}
        <Text backgroundColor="red">{' '}</Text>
        {' 막힘  ! 소진 권장'}
      </Text>
    </Box>
  )
}
