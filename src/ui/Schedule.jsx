import React from 'react'
import { Box, Text } from 'ink'
import { buildSchedule } from '../core/schedule.js'
import { cellWidth, clockAt } from '../core/format.js'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
// 한 시간이 한 칸이다. 눈금은 그 시각의 칸 위에 찍는다. 두 시간마다 세 글자씩
// 찍으면 스물네 칸이 서른다섯 글자가 되어 뒤로 갈수록 칸과 어긋난다.
const HOUR_AXIS = (() => {
  const axis = Array(24).fill(' ')
  for (const hour of [0, 6, 12, 18]) String(hour).split('').forEach((digit, at) => { axis[hour + at] = digit })
  return axis.join('')
})()
// 행 라벨 폭의 하한과 상한. 요일과 "오늘", 계정 번호와 이름이 여기 든다.
const LABEL_MIN = 9
const LABEL_MAX = 14
const fit = (text, width) => {
  let out = ''
  for (const char of text) {
    if (cellWidth(out + char) > width - 1) break
    out += char
  }
  return out + ' '.repeat(width - cellWidth(out))
}
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

// 범례 한 줄이 차지하는 폭. 주간 여력 네 단계와 막힘, 소진 권장 표시.
const LEGEND_WIDTH = 64

function MarkLegend() {
  return (
    <>
      <Text backgroundColor="red">{' '}</Text>
      {' 막힘  ! 소진 권장'}
    </>
  )
}

function Row({ label, cells, tag, width }) {
  return (
    <Text wrap="truncate">
      {/* 라벨 폭을 칸 수로 맞춘다. 한글은 두 칸이라 글자 수로 맞추면 요일 줄과
          계정 줄의 첫 칸이 어긋난다. 넘으면 자른다. */}
      <Text color="gray">{fit(label, width)}</Text>
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
  if (!schedule) return <Text color="gray">{'표본 없음'}</Text>

  const legendRows = columns >= LEGEND_WIDTH ? 1 : 2
  const shown = plan(height - (legendRows - 1), schedule.today.length)
  const nameOf = (account) => `${account.index} ${account.email.split('@')[0]}`
  // 계정 이름이 서로 갈릴 만큼. claude 와 claude2 가 둘 다 "claude" 로 잘리면 안 된다.
  const labelWidth = Math.min(LABEL_MAX, Math.max(LABEL_MIN, ...schedule.today.map((account) => cellWidth(nameOf(account)) + 1)))
  const wideEnough = columns >= labelWidth + 24 + TAG_WIDTH
  const basis = schedule.hasBurn ? '관측 속도 기준 예측' : '리셋 시각만 표시 (예측 없음)'

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="white">{'전체 일정'}</Text>
        <Text color="gray">{`  앞으로 7일  ${basis}`}</Text>
      </Text>
      <Text color="gray" wrap="truncate">{`${' '.repeat(labelWidth)}${HOUR_AXIS}시`}</Text>
      {schedule.days.slice(0, shown.days).map((day) => (
        <Row
          key={day.weekday + (day.today ? 't' : '')}
          label={`${WEEKDAYS[day.weekday]}${day.today ? ' 오늘' : ''}`}
          cells={day.cells}
          width={labelWidth}
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
                label={nameOf(account)}
                cells={account.cells}
                width={labelWidth}
                tag={wideEnough && account.blockedUntil
                  ? `5h ${Math.round(account.shortPct)}%, ${clockAt(account.blockedUntil)} 해제`
                  : null}
              />
            ))}
          </>
          )
        : null}
      {/* 한 줄에 안 들어가면 표시 둘을 다음 줄로 넘긴다. 잘리면 ! 가 무엇인지 사라진다. */}
      <Text color="gray" wrap="truncate">
        {'주간 여력  █ 75%+  ▓ 50~75  ▒ 25~50  ░ 0~25  '}
        {legendRows === 1 ? <MarkLegend /> : null}
      </Text>
      {legendRows === 2 ? <Text color="gray" wrap="truncate"><MarkLegend /></Text> : null}
    </Box>
  )
}
