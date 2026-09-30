import React from 'react'
import { Text } from 'ink'
import { colorForSeries } from './chart.js'
import { shortSpan } from '../core/format.js'
import { needsRelogin } from '../core/policy.js'
import { resetLines } from '../core/resets.js'
import { Bar } from './Bar.jsx'

export const ACTIVE_MARK = '*'

/** 계정 하나가 차지하는 줄 수. 클릭 좌표를 행으로 되짚을 때 쓴다. */
export function blockHeight(row, gap = true, now = Date.now()) {
  const windows = (row.usage?.windows ?? []).length
  return 1 + (windows || 1) + resetLines(row, now).length + (gap ? 1 : 0) // 머리글 + 창들(없으면 안내 1줄) + 리셋 + 빈 줄
}

/**
 * 값이 낡은 이유만 머리글 옆에 짧게 붙인다. 토큰 만료와 갱신, 조회 백오프는
 * 백그라운드가 알아서 하는 일이라 화면에 두지 않는다. 다만 여러 바퀴가 지나도
 * 값이 안 바뀌면 그건 알려야 한다. 낡은 숫자를 최신으로 읽게 두면 안 된다.
 */
function staleTag(row, now, staleAfterMs) {
  const old = row.fetchedAt && now - row.fetchedAt > staleAfterMs
    ? `${shortSpan(now - row.fetchedAt)} 전 값`
    : null
  // 사유가 대기 안내보다 먼저다. 자격증명이 끊긴 계정은 조회가 한 번도 성공한
  // 적이 없어 usage 가 비는데, 순서가 반대면 이름만 빨갛고 까닭이 안 적힌다.
  // 사유가 있는데 막대도 서 있으면 그 숫자가 언제 것인지를 함께 적는다. 조회가
  // 실패해도 Orca 가 지난 값을 함께 주므로, 사유만 있으면 막대를 지금 값으로
  // 읽게 된다.
  if (row.note) return old ? `${row.note}, ${old}` : row.note
  if (!row.usage) return '조회 대기'
  return old
}

/** 재로그인 표시. 남은 기간을 붙여 얼마나 급한지 보인다. */
function reloginTag(token, now) {
  if (token.refresh.revokedAt) return '재로그인 필요'
  const left = token.refresh.expiresAt - now
  return left <= 0 ? '재로그인 필요 (만료됨)' : `재로그인 필요 (${shortSpan(left)} 뒤 만료)`
}

export function AccountBlock({
  row, active, dimmed, selected, now, barWidth, staleAfterMs, gap = true,
}) {
  const tag = staleTag(row, now, staleAfterMs)
  const windows = row.usage?.windows ?? []
  return (
    <>
      {/* 좁은 화면에서 접히면 한 계정이 두 줄을 먹어 아래가 통째로 밀린다. */}
      <Text wrap="truncate">
        <Text color="cyan" bold>{selected ? '>' : ' '}</Text>
        {/* 번호 색이 전체 패널의 선 색과 같다. 어느 선이 어느 계정인지 잇는 유일한 단서다. */}
        <Text color={colorForSeries(row.index - 1)} bold>{String(row.index).padStart(2)}</Text>
        {'  '}
        {/* 활성 표시를 이름 앞에 둔다. 자리는 늘 잡아 두어야 줄이 안 밀린다. */}
        <Text color="yellow" bold>{active ? `${ACTIVE_MARK} ` : '  '}</Text>
        {/* 숨긴 계정은 펼쳐 볼 때만 나온다. 색을 죽여 목록의 나머지와 갈린다. */}
        <Text color={row.authFailed ? 'red' : dimmed ? 'gray' : 'white'} bold={!dimmed}>{row.email}</Text>
        {dimmed ? <Text color="gray">{'  숨김'}</Text> : null}
        {row.label ? <Text color="gray">{`  [${row.label}]`}</Text> : null}
        {tag ? <Text color="gray">{`  ${tag}`}</Text> : null}
        {needsRelogin(row.token, now) ? <Text color="red" bold>{`  ${reloginTag(row.token, now)}`}</Text> : null}
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
        : <Text color="gray">{'     사용량 조회 전'}</Text>}

      {/* 쓸 수 있는 리셋. 쓰면 창이 즉시 비므로 몇 번 더 버티느냐와 같다. */}
      {resetLines(row, now).map((line) => (
        <Text key={line} color="magenta">{`     ${line}`}</Text>
      ))}

      {/* 목록의 마지막 블록은 빈 줄을 뺀다. 낮은 화면에서 그 한 줄이 추천을 밀어낸다. */}
      {gap ? <Text> </Text> : null}
    </>
  )
}
