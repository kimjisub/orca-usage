import React from 'react'
import { Box, Text } from 'ink'
import { chartSeries, colorForSeries, keysForMode, overviewSeries } from '../chart.js'
import { visibleWindows } from '../format.js'
import { AXIS_WIDTH, Chart } from './Chart.jsx'

const DOT = '●'

const isNumber = (value) => typeof value === 'number'

export const MODE_LABEL = {
  level: '사용량 %',
  rate: '소비 %p/h',
}

const Empty = ({ text }) => <Text color="gray">{text}</Text>

/**
 * 창 하나짜리 작은 차트.
 *
 * 창들을 한 격자에 겹쳐 그리면 선이 넷씩 뒤엉켜 무엇을 보는지 알 수 없다. 창마다
 * 따로 그리면 각 격자에 선이 하나뿐이라 모양이 바로 읽힌다. 대신 세로가 나뉘어
 * 각 차트는 작아진다.
 */
function Panel({ label, color, series, min, max, height, mode, from, to, showAxis }) {
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color={color}>{`${DOT} `}</Text>
        <Text color="white">{label}</Text>
      </Text>
      <Chart
        series={[series]}
        colors={[color]}
        min={min}
        max={max}
        height={height - 1}
        mode={mode}
        from={from}
        to={to}
        showAxis={showAxis}
      />
    </Box>
  )
}

// 격자가 이보다 낮으면 눈금과 선이 뭉개져 읽을 게 없다. 다섯 줄이면 눈금이
// 위아래와 가운데 셋은 들어간다.
const MIN_PANEL = 5

/**
 * 창을 몇 개까지 따로 그릴지, 각각 몇 줄을 줄지 정한다.
 *
 * 창 하나가 쓰는 줄은 제목 하나에 격자, 마지막 창에만 시간축 하나가 붙는다.
 * 세로가 모자라면 뒤쪽 창부터 접는다. 5h 와 7d 가 앞에 있어 모델별 창이 먼저
 * 빠지고, 그래도 모자라면 5h 만 남긴다.
 */
function planPanels(height, keys) {
  for (let count = keys.length; count >= 1; count -= 1) {
    const each = Math.floor((height - 1) / count)
    if (each >= MIN_PANEL) return { keys: keys.slice(0, count), each }
  }
  return { keys: keys.slice(0, 1), each: Math.max(4, height - 1) }
}

/**
 * 전체 패널. 계정별로 쪼개지 않고 쓴 양을 전체 캐파로 나눈 값을 그린다.
 *
 * 계정이 모두 같은 요금제면 캐파가 같으므로 계정 사용률의 평균이 곧 그 비율이다.
 * 창은 서로 다른 한도라 합칠 수 없으니 따로 그린다.
 */
export function OverviewGraph({
  accounts, historyById, columns, height, mode, showModelWindows, rangeMs, rangeLabel,
}) {
  // 계정 그래프와 같은 창을 그린다. 5h 와 7d 로 못 박아 두어 Fable 이 빠져 있었다.
  const all = visibleWindows(accounts[0]?.usage?.windows, showModelWindows).map((w) => w.label)
  const keys = keysForMode(all.length ? all : ['5h', '7d'], mode)
  const width = Math.max(10, columns - AXIS_WIDTH)
  const plan = planPanels(Math.max(6, height - 1), keys)

  const { lines, min, max, from, to } =
    overviewSeries(historyById, accounts, keys, width, mode, rangeMs)
  const shown = lines.filter((line) => plan.keys.includes(line.key))
  const drawn = shown.some((line) => line.values.some(isNumber))

  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="white">{mode === 'rate' ? '전체 소비' : '전체 사용량'}</Text>
        <Text color="gray">{`  ${MODE_LABEL[mode]}`}</Text>
        <Text color="cyan">{`  ${rangeLabel}`}</Text>
      </Text>
      {drawn
        ? shown.map((line, index) => (
          <Panel
            key={line.key}
            label={line.key}
            color={colorForSeries(keys.indexOf(line.key))}
            series={line.values}
            min={min}
            max={max}
            height={plan.each}
            mode={mode}
            from={from}
            to={to}
            showAxis={index === shown.length - 1}
          />
          ))
        : <Empty text="표본이 쌓이면 여기에 그려집니다" />}

    </Box>
  )
}

/** 시간을 한두 단위로 줄여 쓴다. 요약 줄은 자리가 좁다. */
function hours(value) {
  if (value == null) return '넉넉'
  if (value < 1) return `${Math.round(value * 60)}m`
  if (value < 48) return `${Math.round(value)}h`
  return `${Math.round(value / 24)}d`
}

/** 추천 한 줄. 라벨 자리를 Box 로 고정한다. 한글은 두 칸이라 padEnd 로는 안 맞는다. */
function Pick({ label, entry, detail, tone = 'white' }) {
  return (
    <Box>
      <Box width={11} flexShrink={0}>
        <Text color="gray">{label}</Text>
      </Box>
      {entry
        ? (
          <Text wrap="truncate">
            <Text color={colorForSeries(entry.index - 1)} bold>{String(entry.index)}</Text>
            <Text color={tone}>{`  ${detail}`}</Text>
          </Text>
          )
        : <Text color="gray">{'-'}</Text>}
    </Box>
  )
}

export function Advice({ tip, autoSwitch, decision }) {
  return (
    <>
      {tip?.allBlocked
        ? (
          <Text wrap="truncate">
            <Text color="red" bold>{'지금 쓰기  '}</Text>
            <Text color="gray">
              {tip.soonestUnblock
                ? `모두 막힘. ${tip.soonestUnblock.index}번이 ${hours((tip.soonestUnblock.shortResetIn ?? 0) / 3600000)} 뒤 풀림`
                : '모두 막힘'}
            </Text>
          </Text>
          )
        : <Pick label="지금 쓰기" entry={tip?.use} detail={tip?.useReason ?? ''} />}
      <Pick
        label="큰 작업"
        entry={tip?.heavy}
        detail={tip?.heavy
          ? `주간 ${Math.round(tip.heavy.reserve)}%  이 속도로 ${hours(tip.heavy.runwayHours)}`
          : ''}
      />
      {tip?.avoid
        ? <Pick label="아껴둘 것" entry={tip.avoid} detail={`주간 ${Math.round(tip.avoid.weeklyPct)}% 씀`} tone="gray" />
        : <Text> </Text>}
      <AutoSwitchLine autoSwitch={autoSwitch} decision={decision} />
    </>
  )
}

/** 자동 전환이 지금 무엇을 보고 있는지. 켜져 있어도 대개는 대기 상태다. */
function AutoSwitchLine({ autoSwitch, decision }) {
  const body = !autoSwitch
    ? { text: '꺼짐  a 로 켭니다', color: 'gray' }
    : decision?.action === 'switch'
      ? { text: `전환[${decision.why}] ${decision.reason}`, color: 'green' }
      : { text: decision?.reason ?? '판단 중', color: 'gray' }
  return (
    <Box>
      <Box width={11} flexShrink={0}>
        <Text color={autoSwitch ? 'green' : 'gray'}>{'자동 전환'}</Text>
      </Box>
      <Text color={body.color} wrap="truncate">{body.text}</Text>
    </Box>
  )
}

/** 계정 패널. 그 계정의 창을 하나씩 따로 그린다. */
export function Graph({
  row, history, columns, height, mode, showModelWindows, rangeMs, rangeLabel,
}) {
  const all = visibleWindows(row.usage?.windows, showModelWindows).map((w) => w.label)
  const keys = keysForMode(all, mode)
  if (!history?.length || keys.length === 0) {
    return <Empty text={`${row.email} - 표본이 쌓이면 여기에 그려집니다`} />
  }

  const width = Math.max(10, columns - AXIS_WIDTH)
  const { series, min, max, from, to } = chartSeries(history, keys, width, mode, rangeMs)
  if (!series.some((line) => line.some(isNumber))) {
    return <Empty text={`${row.email} - 표본이 쌓이면 여기에 그려집니다`} />
  }

  const plan = planPanels(height - 1, keys)
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color="white">{row.email}</Text>
        <Text color="gray">{`  ${MODE_LABEL[mode]}`}</Text>
        <Text color="cyan">{`  ${rangeLabel}`}</Text>
      </Text>
      {plan.keys.map((key, index) => (
        <Panel
          key={key}
          label={key}
          color={colorForSeries(keys.indexOf(key))}
          series={series[keys.indexOf(key)]}
          min={min}
          max={max}
          height={plan.each}
          mode={mode}
          from={from}
          to={to}
          showAxis={index === plan.keys.length - 1}
        />
      ))}
    </Box>
  )
}
