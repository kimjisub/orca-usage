import React from 'react'
import { Text } from 'ink'
import { colorForSeries } from '../chart.js'
import { shortSpan, visibleWindows } from '../format.js'
import { Bar } from './Bar.jsx'

/** 계정 하나가 차지하는 줄 수. 클릭 좌표를 행으로 되짚을 때 쓴다. */
// 배지는 계정마다 하나만 붙는다. 셋 넷씩 달리면 어느 것이 급한지 알 수 없다.
// 막힌 계정은 배지 대신 이름을 빨갛게 칠한다. 배지 자리는 "지금 어떻게 할까" 를
// 답하는 자리라, 아예 못 쓰는 계정은 이름에서 바로 걸러지는 편이 빠르다.
export const BADGES = {
  spurt: { text: '소진 권장', color: '#ff9f0a' },
  use: { text: '우선 사용', color: 'green' },
  spare: { text: '사용 자제', color: 'gray' },
}
export const ACTIVE_MARK = '*' 

export function blockHeight(row, showModelWindows = true) {
  const windows = visibleWindows(row.usage?.windows, showModelWindows).length
  return 1 + (windows || 1) + 1 // 머리글 + 창들(없으면 안내 1줄) + 빈 줄
}

/**
 * 값이 낡은 이유만 머리글 옆에 짧게 붙인다. 토큰 만료와 갱신, 조회 백오프는
 * 백그라운드가 알아서 하는 일이라 화면에 두지 않는다. 다만 여러 바퀴가 지나도
 * 값이 안 바뀌면 그건 알려야 한다. 낡은 숫자를 최신으로 읽게 두면 안 된다.
 */
function staleTag(row, now, staleAfterMs) {
  if (!row.usage) return '대기 중'
  if (row.note) return row.note
  if (row.fetchedAt && now - row.fetchedAt > staleAfterMs) {
    return `${shortSpan(now - row.fetchedAt)} 전 값`
  }
  return null
}

export function AccountBlock({
  row, active, selected, now, barWidth, showModelWindows, staleAfterMs, badge,
}) {
  const tag = staleTag(row, now, staleAfterMs)
  const mark = BADGES[badge]
  const blocked = badge === 'blocked' 
  const windows = visibleWindows(row.usage?.windows, showModelWindows)
  return (
    <>
      <Text>
        <Text color="cyan" bold>{selected ? '>' : ' '}</Text>
        {/* 번호 색이 전체 패널의 선 색과 같다. 어느 선이 어느 계정인지 잇는 유일한 단서다. */}
        <Text color={colorForSeries(row.index - 1)} bold>{String(row.index).padStart(2)}</Text>
        {'  '}
        {/* 활성 표시를 이름 앞에 둔다. 자리는 늘 잡아 두어야 줄이 안 밀린다. */}
        <Text color="yellow" bold>{active ? `${ACTIVE_MARK} ` : '  '}</Text>
        <Text color={blocked ? 'red' : 'white'} bold>{row.email}</Text>
        {row.label ? <Text color="gray">{`  [${row.label}]`}</Text> : null}
        {mark ? <Text color={mark.color} bold>{`  ${mark.text}`}</Text> : null}
        {tag ? <Text color="gray">{`  ${tag}`}</Text> : null}
      </Text>

      {windows.length
        ? windows.map((window) => (
          <Bar
            key={window.label}
            label={window.label}
            pct={window.pct}
            resetsAt={window.resetsAt}
            width={barWidth}
            now={now}
          />
          ))
        : <Text color="gray">{'     아직 받은 사용량이 없습니다'}</Text>}

      <Text> </Text>
    </>
  )
}
