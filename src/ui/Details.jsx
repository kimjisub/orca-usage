import React from 'react'
import { Box, Text } from 'ink'
import { cellWidth, clockAt, shortSpan } from '../core/format.js'

// 한 줄에 제목과 값. 제목 폭을 맞춰 세로가 줄로 읽힌다. 한글은 두 칸이다.
const TOPIC_WIDTH = 16
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))
const DAY_MS = 24 * 3_600_000

/** 값을 어디서 받았나. 백엔드의 조회 경로 이름을 사람 말로 옮긴다. */
const SOURCE_LABEL = {
  orca: 'Orca 가 받은 값',
  direct: '키체인으로 직접 조회한 값 (Orca 연결 안 됨)',
  'orca-miss': 'Orca 가 이 계정을 못 받아 직접 조회했거나 지난 값',
  cache: '지난 값 (Orca 연결 안 됨, Codex 는 직접 조회가 없음)',
}

/** 12:30 (3분 전) 처럼 시각과 지금부터의 거리를 함께. 오늘이 아니면 날짜도. */
function when(at, now) {
  if (!at) return '모름'
  const clock = clockAt(at, { withDate: Math.abs(now - at) > 12 * 3_600_000 })
  if (Math.abs(now - at) < 1_000) return `${clock} (지금)`
  return at > now ? `${clock} (${shortSpan(at - now)} 뒤)` : `${clock} (${shortSpan(now - at)} 전)`
}

/** 토큰이 얼마나 남았나. 이미 만료됐으면 얼마나 지났나. 색도 함께 정한다. */
function expiryLine(expiresAt, now) {
  if (!expiresAt) return { text: '모름', color: 'gray' }
  const left = expiresAt - now
  if (left <= 0) return { text: `${clockAt(expiresAt, { withDate: true })} 에 만료, ${shortSpan(-left)} 지남`, color: 'red' }
  return {
    text: `${clockAt(expiresAt, { withDate: left > 12 * 3_600_000 })} 까지, ${shortSpan(left)} 남음`,
    color: left < 30 * 60_000 ? 'yellow' : 'white',
  }
}

const OWNER_LABEL = {
  orca: '살아 있는 동안은 Orca 가 갱신',
  backend: '만료된 지 한 시간이 넘어 백엔드가 다음 조회에 갱신',
}

/** 계정 하나의 상세를 줄 목록으로 만든다. 그리는 쪽은 높이만큼 자른다. */
function accountLines(row, { history, log, now, staleAfterMs }) {
  const lines = []
  const title = (text) => lines.push({ title: text })
  const item = (topic, text, color = 'white') => lines.push({ topic, text, color })

  const tags = [row.active ? '지금 쓰는 계정' : null, row.hidden ? '숨김' : null, row.system ? 'Orca 가 관리하지 않는 로그인' : null]
    .filter(Boolean).join(', ')
  lines.push({
    heading: `${row.index}  ${row.email}`,
    sub: `${row.provider === 'codex' ? 'Codex' : 'Claude'}${row.label ? `  [${row.label}]` : ''}${tags ? `  ${tags}` : ''}`,
  })
  item('계정 id', row.id, 'gray')

  title('사용량')
  const old = row.fetchedAt && now - row.fetchedAt > staleAfterMs
  item('받은 시각', when(row.fetchedAt, now), old ? 'yellow' : 'white')
  item('어디서', SOURCE_LABEL[row.source] ?? row.source ?? '아직 조회 전', 'gray')
  for (const window of row.usage?.windows ?? []) {
    const reset = window.resetsAt ? `리셋 ${when(Date.parse(window.resetsAt), now)}` : '리셋 시각 없음 (창이 닫혀 있음)'
    item(`  ${window.label}`, `${String(Math.round(window.pct)).padStart(3)}%   ${reset}`)
  }
  if (row.credits?.available != null) item('  리셋 크레딧', `${row.credits.available}개`)
  if (row.retryUntil && row.retryUntil > now) {
    item('백오프', `${when(row.retryUntil, now)} 까지 조회를 쉰다 (호출 예산 초과)`, 'yellow')
  }
  if (row.note) item('사유', row.note, row.authFailed ? 'red' : 'yellow')

  title('토큰')
  const token = row.token
  if (!token) {
    item('만료', '읽지 못했다', 'gray')
  } else {
    const expiry = expiryLine(token.expiresAt, now)
    item('만료', expiry.text, expiry.color)
    if (token.source === 'codex-auth') {
      item('마지막 갱신', token.refreshedAt ? `${when(token.refreshedAt, now)}, Orca 나 Codex 가 함` : '모름')
      item('누가', 'Codex 토큰은 Orca 와 Codex 가 갱신한다. 이 도구는 읽기만 한다', 'gray')
    } else {
      const owner = token.owner === 'retry'
        ? `백엔드가 갱신에 실패했다. ${when(token.retryAt, now)} 에 다시 해 본다`
        : OWNER_LABEL[token.owner] ?? token.owner
      item('누가', owner, token.owner === 'retry' ? 'red' : token.owner === 'backend' ? 'yellow' : 'white')
      item('이 도구가 갱신', token.refreshedAt
        ? when(token.refreshedAt, now)
        : '없음. Orca 가 한 갱신은 여기 안 보인다', 'gray')
      item('확인한 시각', `${when(token.checkedAt, now)}, 키체인에서`, 'gray')
    }
  }

  title('히스토리')
  const series = history?.[row.id] ?? []
  if (series.length) {
    item('표본', `${series.length}개, ${when(series[0].at, now)} 부터`)
    item('마지막 표본', when(series.at(-1).at, now))
  } else {
    item('표본', '없음', 'gray')
  }

  const recent = log.filter((entry) => entry.email === row.email).slice(0, 6)
  title('최근 기록')
  if (recent.length === 0) item('', '없음', 'gray')
  for (const entry of recent) {
    item(clockAt(entry.at, { withDate: now - entry.at > DAY_MS / 2 }), entry.text,
      entry.kind === 'error' || entry.ok === false ? 'red' : 'gray')
  }
  return lines
}

/** 합계 줄을 골랐을 때. 계정마다 한 줄로 값의 나이와 토큰 만료를 견준다. */
function overviewLines(rows, now) {
  const lines = [{ heading: '계정별 상세', sub: '계정을 고르면 그 계정만 자세히 봅니다' }]
  lines.push({ header: true, text: `${pad('계정', 30)}${pad('값', 14)}토큰` })
  for (const row of rows) {
    const got = row.fetchedAt ? `${shortSpan(now - row.fetchedAt)} 전` : '조회 전'
    const expiry = expiryLine(row.token?.expiresAt, now)
    const name = `${row.index} ${row.email}`
    lines.push({
      table: true,
      cells: [
        { text: pad(name.length > 28 ? `${name.slice(0, 27)}.` : name, 30), color: row.active ? 'white' : 'gray' },
        { text: pad(got, 14), color: 'white' },
        { text: row.token?.expiresAt ? (expiry.color === 'red' ? `${shortSpan(now - row.token.expiresAt)} 전 만료` : `${shortSpan(row.token.expiresAt - now)} 남음`) : '모름', color: expiry.color },
      ],
    })
  }
  return lines
}

/**
 * 상세. 값이 언제 것이고 토큰이 얼마나 남았는지처럼, 막대로는 안 보이는 것을
 * 글로 적는다. 전부 백엔드가 준 상태를 옮겨 적는 것이고 여기서 판단하지 않는다.
 */
export function Details({ row, rows, history, log, now, height, columns, staleAfterMs }) {
  const lines = row
    ? accountLines(row, { history, log, now, staleAfterMs })
    : overviewLines(rows, now)
  const body = Math.max(10, columns - TOPIC_WIDTH - 2)
  return (
    <Box flexDirection="column">
      {lines.slice(0, Math.max(1, height)).map((line, index) => {
        if (line.heading) {
          return (
            <Text key={index} wrap="truncate">
              <Text color="white" bold>{line.heading}</Text>
              <Text color="gray">{`  ${line.sub}`}</Text>
            </Text>
          )
        }
        if (line.title) return <Text key={index} color="cyan" bold wrap="truncate">{line.title}</Text>
        if (line.header) return <Text key={index} color="gray" wrap="truncate">{`  ${line.text}`}</Text>
        if (line.table) {
          return (
            <Text key={index} wrap="truncate">
              {'  '}
              {line.cells.map((cell, at) => <Text key={at} color={cell.color}>{cell.text}</Text>)}
            </Text>
          )
        }
        return (
          <Text key={index} wrap="truncate">
            <Text color="gray">{`  ${pad(line.topic, TOPIC_WIDTH)}`}</Text>
            <Text color={line.color}>{line.text.length > body * 2 ? `${line.text.slice(0, body * 2)}...` : line.text}</Text>
          </Text>
        )
      })}
    </Box>
  )
}
