import React from 'react'
import { Box, Text } from 'ink'
import { cellWidth, clockAt, shortSpan } from '../core/format.js'
import { CLEARS_LABEL, liveGrants } from '../core/resets.js'

// 한 줄에 제목과 값. 제목 폭을 맞춰 세로가 줄로 읽힌다. 한글은 두 칸이다.
const TOPIC_WIDTH = 16
const pad = (text, width) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))
const DAY_MS = 24 * 3_600_000

/** 값을 어디서 받았나. 백엔드의 조회 경로 이름을 사람 말로 옮긴다. */
const SOURCE_LABEL = {
  orca: 'Orca',
  direct: '키체인 직접 조회 (Orca 연결 없음)',
  'orca-miss': '직접 조회 또는 이전 값 (Orca 미수신 계정)',
  cache: '이전 값 (Orca 연결 없음, Codex 직접 조회 불가)',
}

/** 12:30 (3분 전) 처럼 시각과 지금부터의 거리를 함께. 오늘이 아니면 날짜도. */
function when(at, now) {
  if (!at) return '모름'
  const clock = clockAt(at, { withDate: Math.abs(now - at) > 12 * 3_600_000 })
  if (Math.abs(now - at) < 1_000) return `${clock} (지금)`
  return at > now ? `${clock} (${shortSpan(at - now)} 뒤)` : `${clock} (${shortSpan(now - at)} 전)`
}

// 이만큼 남으면 노랗게 알린다. access token 은 Orca 가 곧 갱신하고, refresh token 은
// 지나면 Orca 에서 다시 로그인해야 하므로 며칠 앞서 보여야 한다.
const SOON = { access: 30 * 60_000, refresh: 3 * DAY_MS }

/** 토큰이 얼마나 남았나. 이미 만료됐으면 얼마나 지났나. 색도 함께 정한다. */
function expiryLine(expiresAt, now, soon = SOON.access) {
  if (!expiresAt) return { text: '모름', color: 'gray' }
  const left = expiresAt - now
  if (left <= 0) return { text: `만료됨, ${clockAt(expiresAt, { withDate: true })} (${shortSpan(-left)} 경과)`, color: 'red' }
  return {
    text: `${clockAt(expiresAt, { withDate: left > 12 * 3_600_000 })} (${shortSpan(left)} 남음)`,
    color: left < soon ? 'yellow' : 'white',
  }
}

/** 표 한 칸에 들어갈 짧은 만료. */
function expiryCell(expiresAt, now, soon = SOON.access) {
  if (!expiresAt) return { text: '모름', color: 'gray' }
  const expiry = expiryLine(expiresAt, now, soon)
  const left = expiresAt - now
  return { text: left <= 0 ? `만료 (${shortSpan(-left)} 경과)` : `${shortSpan(left)} 남음`, color: expiry.color }
}

const OWNER_LABEL = {
  orca: 'Orca (만료 전)',
  backend: 'orca-usage 백엔드 (만료 후 1시간 경과)',
}

/** refresh token 의 상태. 발급처가 폐기했다고 답했으면 그것이 먼저다. */
function refreshState(refresh) {
  if (!refresh || refresh.present == null) return { text: '확인 전', color: 'gray' }
  if (refresh.revokedAt) return { text: '폐기됨 (Orca 재로그인 필요)', color: 'red' }
  if (!refresh.present) return { text: '없음 (Orca 재로그인 필요)', color: 'red' }
  return { text: '있음', color: 'white' }
}

/** 계정 하나의 상세를 줄 목록으로 만든다. 그리는 쪽은 높이만큼 자른다. */
function accountLines(row, { history, log, now, staleAfterMs }) {
  const lines = []
  const title = (text) => lines.push({ title: text })
  const item = (topic, text, color = 'white') => lines.push({ topic, text, color })

  const tags = [row.active ? '사용 중' : null, row.hidden ? '숨김' : null, row.system ? 'Codex 기본 로그인 (Orca 관리 밖)' : null]
    .filter(Boolean).join(', ')
  lines.push({
    heading: `${row.index}  ${row.email}`,
    sub: `${row.provider === 'codex' ? 'Codex' : 'Claude'}${row.label ? `  [${row.label}]` : ''}${tags ? `  ${tags}` : ''}`,
  })
  item('계정 ID', row.id, 'gray')

  title('사용량')
  const old = row.fetchedAt && now - row.fetchedAt > staleAfterMs
  item('조회 시각', when(row.fetchedAt, now), old ? 'yellow' : 'white')
  item('출처', SOURCE_LABEL[row.source] ?? row.source ?? '조회 전', 'gray')
  for (const window of row.usage?.windows ?? []) {
    const reset = window.resetsAt ? `리셋 ${when(Date.parse(window.resetsAt), now)}` : '리셋 시각 없음 (창 닫힘)'
    item(`  ${window.label}`, `${String(Math.round(window.pct)).padStart(3)}%   ${reset}`)
  }
  if (row.credits?.available != null) item('  리셋 크레딧', `${row.credits.available}개`)
  if (row.retryUntil && row.retryUntil > now) {
    item('조회 보류', `${when(row.retryUntil, now)} 까지 (호출 한도 초과)`, 'yellow')
  }
  if (row.note) item('사유', row.note, row.authFailed ? 'red' : 'yellow')

  const token = row.token
  const codex = token?.source === 'codex-auth'
  title('Access token')
  if (!token) {
    item('만료', '읽기 실패', 'gray')
  } else {
    const expiry = expiryLine(token.expiresAt, now)
    // Codex 는 만료된 access token 을 다음 사용 때 스스로 갱신한다. 쓰지 않는 동안
    // 만료돼 있는 것은 정상이라 빨갛게 두지 않는다.
    const codexIdle = codex && token.expiresAt && token.expiresAt <= now
    item('만료', expiry.text, codexIdle ? 'yellow' : expiry.color)
    const by = token.renewedBy === 'backend' ? ', orca-usage 백엔드' : token.renewedBy === 'other' ? ', Orca' : ''
    item('갱신 시각', token.renewedAt ? `${when(token.renewedAt, now)}${by}` : (codex ? '모름' : '백엔드 시작 이후 없음'),
      token.renewedAt ? 'white' : 'gray')
    if (codex) {
      item('갱신 주체', 'Codex', 'gray')
    } else {
      const owner = token.owner === 'retry'
        ? `orca-usage 백엔드, 갱신 실패 후 재시도 대기 (${when(token.retryAt, now)})`
        : OWNER_LABEL[token.owner] ?? token.owner
      item('갱신 주체', owner, token.owner === 'retry' ? 'red' : token.owner === 'backend' ? 'yellow' : 'white')
    }
    item('확인 시각', `${when(token.checkedAt, now)}, ${codex ? 'auth.json' : '키체인'}`, 'gray')
  }

  title('Refresh token')
  if (token) {
    const state = refreshState(token.refresh)
    item('상태', state.text, state.color)
    if (codex) {
      // 기한이 없다. 쓰는 동안 Codex 가 갱신해 이어 가고, 1회용이라 다른 곳이 쓰면 끊긴다
      // (adapters/orca/codex-auth.js). 대신 브라우저 로그인 시각을 보인다.
      item('기한', '없음', 'gray')
      item('로그인 시각', token.loginAt ? when(token.loginAt, now) : '모름', token.loginAt ? 'white' : 'gray')
    } else {
      const expiry = expiryLine(token.refresh?.expiresAt, now, SOON.refresh)
      item('기한', token.refresh?.expiresAt ? expiry.text : '모름 (키체인에 값 없음)', expiry.color)
    }
    const rotated = token.refresh?.rotatedAt
    item('교체 시각', rotated ? when(rotated, now) : '백엔드 시작 이후 없음', rotated ? 'white' : 'gray')
  } else {
    item('상태', '읽기 실패', 'gray')
  }

  resetSection(row, { title, item, now })

  title('히스토리')
  const series = history?.[row.id] ?? []
  if (series.length) {
    item('표본 수', `${series.length}개`)
    item('첫 표본', when(series[0].at, now))
    item('마지막 표본', when(series.at(-1).at, now))
  } else {
    item('표본 수', '0개', 'gray')
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

// Claude 가 리셋을 주지 않는 이유. 서버의 ineligible_reason 을 사람 말로.
const RESET_REASON = {
  not_at_wall: '5h 한도 도달 시 사용 가능',
  surface: 'Claude Code 에서만 제공',
  no_grant: '받은 권 없음',
  tier: '요금제 대상 아님',
  tenure: '가입 기간 대상 아님',
  weekly_limit: '이번 주 사용함',
  cli_version: 'Claude Code 버전 낮음',
  unavailable: '지금 제공 안 함',
}
const reasonText = (reason) => RESET_REASON[reason] ?? reason ?? '대상 아님'

/**
 * 리셋. Claude 는 전체 초기화 권과 주 1회 5시간 초기화, Codex 는 리셋 크레딧이다.
 * Claude 리셋은 이 도구가 쓰지 않는다. 서버가 Claude Code 의 요청만 받는다.
 */
function resetSection(row, { title, item, now }) {
  title('리셋')
  if (row.provider === 'codex') {
    const credits = row.credits
    if (!credits || !(credits.available > 0)) {
      item('리셋 크레딧', '없음', 'gray')
      return
    }
    const next = credits.nextExpiresAt ? `, 가장 이른 만료 ${when(credits.nextExpiresAt, now)}` : ''
    item('리셋 크레딧', `${credits.available}개${next}`, 'magenta')
    return
  }
  const resets = row.resets
  if (!resets || (!resets.grants && !resets.session)) {
    item('상태', resets?.error ? `확인 실패 (${resets.error})` : '확인 전', 'gray')
    return
  }
  const grants = liveGrants(resets)
  if (grants.length === 0) {
    const used = (resets.grants?.list ?? []).some((grant) => grant.resetsLeft === 0)
    item('전체 초기화', used ? '사용함' : resets.grants?.eligible === false ? reasonText(resets.grants.reason) : '없음', 'gray')
  }
  for (const grant of grants) {
    item('전체 초기화', `${grant.resetsLeft}회 남음 (총 ${grant.resetsTotal}회)${grant.endsAt ? `, ${when(grant.endsAt, now)} 까지` : ''}`, 'magenta')
    item('  비우는 창', grant.clears.map((key) => CLEARS_LABEL[key] ?? key).join(', ') || '모름', 'gray')
    item('  사용 조건', grant.usableNow ? '지금 가능' : grant.useRequiresLimit ? '한도 도달 시' : '지금 불가', grant.usableNow ? 'white' : 'gray')
    if (grant.label) item('  이름', grant.label, 'gray')
  }
  const session = resets.session
  if (session) {
    const per = session.perWeek ? `주 ${session.perWeek}회, ` : ''
    const state = session.available ? '지금 가능'
      : session.nextAvailableAt ? `${when(session.nextAvailableAt, now)} 부터 가능`
        : reasonText(session.reason)
    item('5시간 초기화', `${per}${state}`, session.available ? 'magenta' : 'gray')
  }
  item('확인 시각', `${when(resets.checkedAt, now)}${resets.error ? `, 마지막 확인 실패 (${resets.error})` : ''}`, 'gray')
}

/** 합계 줄을 골랐을 때. 계정마다 한 줄로 값의 나이와 토큰 만료를 견준다. */
function overviewLines(rows, now, columns = 90) {
  // 계정 칸이 남는 폭을 쓴다. 뒤의 세 칸은 값이라 잘리면 안 된다.
  const nameWidth = Math.max(12, Math.min(30, columns - 2 - 14 - 16 - 14))
  const lines = [{ heading: '전체 계정', sub: '' }]
  lines.push({ header: true, text: `${pad('계정', nameWidth)}${pad('사용량 조회', 14)}${pad('Access token', 16)}Refresh token` })
  for (const row of rows) {
    const got = row.fetchedAt ? `${shortSpan(now - row.fetchedAt)} 전` : '조회 전'
    const access = expiryCell(row.token?.expiresAt, now)
    const state = row.token ? refreshState(row.token.refresh) : { text: '확인 전', color: 'gray' }
    // 문제가 있으면 상태를, 없으면 남은 기간을 적는다. 남은 기간을 모르면 상태(있음)다.
    const refresh = state.color !== 'white' ? { text: state.text.split(' (')[0], color: state.color }
      : row.token.refresh?.expiresAt ? expiryCell(row.token.refresh.expiresAt, now, SOON.refresh)
        : row.token.source === 'codex-auth' ? { text: '기한 없음', color: 'gray' }
          : { text: state.text, color: state.color }
    const name = `${row.index} ${row.email}`
    lines.push({
      table: true,
      cells: [
        { text: pad(name.length > nameWidth - 2 ? `${name.slice(0, nameWidth - 3)}.` : name, nameWidth), color: row.active ? 'white' : 'gray' },
        { text: pad(got, 14), color: 'white' },
        { text: pad(access.text, 16), color: access.color },
        { text: refresh.text, color: refresh.color },
      ],
    })
  }
  return lines
}

/**
 * 상세. 값이 언제 것이고 토큰이 얼마나 남았는지처럼, 막대로는 안 보이는 것을
 * 글로 적는다. 전부 백엔드가 준 상태를 옮겨 적는 것이고 여기서 판단하지 않는다.
 */
export function detailLines({ row, rows, history, log, now, staleAfterMs, columns }) {
  return row
    ? accountLines(row, { history, log, now, staleAfterMs })
    : overviewLines(rows, now, columns)
}

/**
 * 높이를 넘으면 offset 부터 그리고, 아래가 남았으면 마지막 줄에 그 사실을 적는다.
 * 좁은 화면에서는 토큰 절이 첫 화면 밖으로 밀린다.
 */
export function Details({ row, rows, history, log, now, height, columns, staleAfterMs, offset = 0 }) {
  const all = detailLines({ row, rows, history, log, now, staleAfterMs, columns })
  const room = Math.max(1, height)
  const start = Math.max(0, Math.min(offset, all.length - room))
  let lines = all.slice(start, start + room)
  const below = all.length - start - room
  if (below > 0) lines = [...lines.slice(0, -1), { hint: `+${below + 1}줄` }]
  const body = Math.max(10, columns - TOPIC_WIDTH - 2)
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => {
        if (line.hint) return <Text key={index} color="gray" wrap="truncate">{`  ${line.hint}`}</Text>
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
