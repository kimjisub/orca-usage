import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { RANGES } from './chart.js'
import { TUNABLES, TUNING_DEFAULTS, applyTuning } from '../core/tuning.js'
import { cellWidth, shortSpan } from '../core/format.js'
import { versionLabel } from '../adapters/install/install.js'
import { useFullscreen } from './fullscreen.js'
import { isMouseSequence, parseMouseClick, useMouseReporting } from './mouse.js'
import { useBackend } from './useBackend.js'
import { AccountBlock, blockHeight } from './AccountBlock.jsx'
import { TotalBars, totalBarsHeight } from './TotalBars.jsx'
import { AUTO_BLOCK_ROWS, Advice, AutoBlock, Graph, OverviewGraph, adviceHeight } from './Graph.jsx'
import { Hit, HitRoot } from './Hit.jsx'
import { Schedule } from './Schedule.jsx'
import { Log, logVisibleRows } from './Log.jsx'
import { SETTINGS_ROWS, Settings } from './Settings.jsx'
import { Help, helpRows, helpVisibleRows } from './Help.jsx'
import { Score } from './Score.jsx'
import { Details, detailLines } from './Details.jsx'
import { needsScreenRestart } from './follow-backend.js'
import { needsRelogin } from '../core/policy.js'
import { actionLines, tabWindow } from './bars.js'

const HEADER_ROWS = 2
// 종료와 업데이트를 되묻는 시간. 이 안에 다시 누르면 한다.
const CONFIRM_WINDOW_MS = 3000
// 섹션 머리글. 계정 수와 창 구조가 provider 마다 달라 목록을 갈라 세운다.
const PROVIDER_LABEL = { claude: 'Claude', codex: 'Codex' }
// 합계 줄이 앉는 선택 자리. 계정은 0 부터라 음수를 쓰고, 탭 줄(-2)을 비켜 간다.
const TOTAL_AT = { claude: -1, codex: -3 }
const TOTAL_PROVIDER = { '-1': 'claude', '-3': 'codex' }
const totalAt = (provider) => TOTAL_AT[provider] ?? TOTAL_AT.claude
// 좁은 화면에서 목록이 차지하는 탭. 넓으면 목록이 왼쪽에 늘 서 있어 탭이 없다.
const ACCOUNTS_TAB = { mode: 'accounts', label: '계정' }
// 고른 계정을 대상으로 그리는 탭. 좁은 화면에서는 목록이 안 보이므로 대상을 따로 적는다.
const TARGETED = new Set(['level', 'rate', 'detail'])
// 오른쪽 패널이 보여줄 것. 좌우 화살표가 이 순서로 돌고 탭도 이 순서다.
const GRAPH_TABS = [
  { mode: 'level', label: '사용량' },
  { mode: 'rate', label: '소비' },
  { mode: 'detail', label: '상세' },
  { mode: 'schedule', label: '일정' },
  { mode: 'score', label: '판정' },
  { mode: 'log', label: '기록' },
  { mode: 'settings', label: '설정' },
  { mode: 'help', label: '도움말' },
]
// 화면을 켰을 때의 그래프 기간. 24h.
const DEFAULT_RANGE = RANGES.findIndex((range) => range.label === '24h')
// 판정 화면의 지표 셋은 가중치 항목과 순서가 같다.
const WEIGHT_KEYS = ['weightBehind', 'weightNow', 'weightReserve']
// 그래프 상자 안쪽이 이보다 좁으면 그래프를 접고 목록이 폭을 다 쓴다. 눈금
// 여섯 칸을 빼고 서른 칸은 있어야 선이 형태를 갖춘다. 화면 폭이 아니라 목록이
// 쓰고 남는 칸으로 재는 이유는, 목록 폭이 긴 이메일을 따라 늘기 때문이다.
const MIN_GRAPH_WIDTH = 36
// 이보다 낮으면 추천을 첫 줄만 남긴다.
const TIGHT_ROWS = 30
// 라벨을 짧게 둔다. 한 줄에 다 실려야 해서 길면 통째로 밀린다. 패널 이동은
// 좌우 화살표와 탭 클릭이라 키가 없다.
const ACTIONS = [
  { key: 'r', label: '전체 재조회' },
  { key: 't', label: '토큰 갱신' },
  { key: 'a', label: '자동 전환' },
  { key: 'o', label: '창 미리 열기' },
  { key: 'w', label: '기간' },
  { key: 'x', label: '숨김' },
  { key: 'enter', label: '계정 전환' },
  { key: 'q', label: '종료' },
]
// 이 화면의 버전. 백엔드와 다르면 업데이트 뒤 한쪽만 새 코드로 도는 중이다.
const SCREEN_VERSION = versionLabel()

/**
 * 머리글. 왼쪽은 지금 일어난 일, 오른쪽은 백엔드의 상태다. 백엔드에 붙어
 * 있지 않으면 그 사실이 가장 먼저다. 붙어 있지 않은 동안의 숫자는 낡았다.
 */
function Header({ status, snapshot, hello, now, message }) {
  const poll = snapshot?.poll
  let right
  if (status === 'lost') {
    right = <Text color="yellow" bold>{'백엔드 연결 끊김, 재연결 중'}</Text>
  } else if (!snapshot) {
    right = <Text color="gray">{'백엔드 연결 중'}</Text>
  } else {
    const countdown = poll?.running ? '조회 중' : poll?.nextAt ? `다음 조회 ${shortSpan(poll.nextAt - now)}` : ''
    const relogin = (snapshot.accounts ?? []).filter((row) => needsRelogin(row.token, now)).length
    right = (
      <>
        {/* 놓치면 계정 하나가 통째로 멈춘다. 머리글에서 가장 먼저 보이게 둔다. */}
        {relogin ? <Text color="red" bold>{`재로그인 필요 ${relogin}  `}</Text> : null}
        {/* Orca 없이 직접 치는 중이면 알린다. 값이 낡거나 백오프에 걸릴 수 있어서다. */}
        {snapshot.orca?.connected ? null : <Text color="yellow">{'Orca 연결 없음, 직접 조회  '}</Text>}
        {hello && hello.version !== SCREEN_VERSION
          ? <Text color="yellow">{`백엔드 버전 ${hello.version}  `}</Text>
          : null}
        {snapshot.update?.available ? <Text color="cyan" bold>{'업데이트 있음 (u)  '}</Text> : null}
        {snapshot.policy?.autoSwitch ? <Text color="green" bold>{'자동 전환  '}</Text> : null}
        {/* 터미널에서 직접 띄운 백엔드다. 그 터미널을 닫으면 사라진다. */}
        {hello && hello.source !== 'launchd' ? <Text color="gray">{'수동 실행 백엔드  '}</Text> : null}
        <Text color="gray">{countdown}</Text>
      </>
    )
  }
  return (
    <>
      {/* 좁은 화면에서 두 덩이가 맞물려 접히면 머리글이 두 줄을 먹는다. */}
      <Box justifyContent="space-between" paddingX={1} flexShrink={0}>
        <Text wrap="truncate">
          {/* 이 화면의 버전. 백엔드와 다르면 오른쪽에 따로 알린다. */}
          <Text color="white" bold>{'orca-usage '}</Text>
          <Text color="gray">{SCREEN_VERSION}</Text>
          {message ? <Text color="yellow">{`   ${message}`}</Text> : null}
        </Text>
        <Text wrap="truncate">{right}</Text>
      </Box>
      <Text> </Text>
    </>
  )
}

/** 업데이트가 있으면 u 가 종료 앞에 들어간다. */
const actionsFor = (updateAvailable) => (updateAvailable
  ? [...ACTIONS.slice(0, -1), { key: 'u', label: '업데이트' }, ACTIONS.at(-1)]
  : ACTIONS)

/** 단축키 줄. 폭이 모자라면 항목을 통째로 다음 줄로 넘긴다(bars.js). */
function ActionBar({ lines }) {
  return (
    <Box flexDirection="column" flexShrink={0}>
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate">
          {'  '}
          {line.map((action) => (
            <Text key={action.key}>
              <Text color="cyan">{`[${action.key}]`}</Text>
              <Text color="gray">{` ${action.label}  `}</Text>
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

// 탭 줄의 클릭 좌표를 재는 자리. 계정 번호와 안 겹치는 값이면 된다.
const TAB_HIT = -2

/**
 * 탭 줄. 무엇을 볼 수 있고 지금 어디인지 한 줄로 보인다. 눌러도 바뀐다.
 * 폭이 모자라면 고른 탭 주변만 두고 가려진 쪽에 `<` `>` 를 붙인다(bars.js).
 */
function Tabs({ view, mode }) {
  return (
    <Text wrap="truncate">
      <Text color="gray">{view.lead}</Text>
      {view.items.map((tab) => (
        <Text key={tab.mode} color={tab.mode === mode ? 'cyan' : 'gray'} bold={tab.mode === mode}>
          {tab.mode === mode ? ` [${tab.label}]` : `  ${tab.label} `}
        </Text>
      ))}
      <Text color="gray">{view.tail}</Text>
    </Text>
  )
}

/** 좁은 화면에서 그래프와 상세가 누구를 그리는지. 목록이 안 보여서 따로 적는다. */
function TargetLine({ row, provider }) {
  return (
    <Text wrap="truncate">
      <Text color="gray">{'대상  '}</Text>
      {row
        ? <Text color="white">{`${row.index} ${row.email}`}</Text>
        : <Text color="white">{`${PROVIDER_LABEL[provider] ?? provider} 전체`}</Text>}
      <Text color="gray">{'  (위아래로 변경)'}</Text>
    </Text>
  )
}

/**
 * 화면. 백엔드가 하는 일을 보여 주고 사람이 누른 것을 백엔드에 보낸다.
 *
 * 스스로 판단하거나 행동하지 않는다. 계정, 사용량, 추천, 전환 판단, 정책은 전부
 * 백엔드의 상태를 그대로 그린다. 여기 있는 상태는 지금 보는 탭, 기간, 고른 줄,
 * 스크롤처럼 보는 방법뿐이고 파일에 남기지 않는다.
 *
 * @param {{graphStyle?: string, onRestart?: () => void}} props
 *   onRestart 는 업데이트 뒤 새 코드로 다시 떠야 할 때 부른다. 부른 뒤 화면을 닫는다
 */
export function App({ graphStyle = 'braille', onRestart = () => {} }) {
  const { exit } = useApp()
  const { columns, rows: screenRows } = useFullscreen()
  const { status, snapshot, history, log: logEntries, hello, request } = useBackend()

  // ---- 보는 방법. 메모리에만 둔다 ----
  const [showHidden, setShowHidden] = useState(false)
  const [selected, setSelected] = useState(TOTAL_AT.claude)
  const [graphMode, setGraphMode] = useState('level')
  const [rangeIndex, setRangeIndex] = useState(DEFAULT_RANGE)
  const [tuneAt, setTuneAt] = useState(0)
  // 판정 화면에서 고른 지표. 설정 화면의 항목 선택과 따로 둔다.
  const [scoreAt, setScoreAt] = useState(0)
  // 값을 고치는 중인가. 설정과 판정은 좌우로 값을 옮기는데, 그 손놀림이 패널
  // 이동과 같은 키라 Enter 로 한 번 들어와야 값이 움직인다. 그러지 않으면
  // 탭을 옮기려다 가중치가 바뀌고, 바뀐 줄도 모른 채 순위가 달라진다.
  const [editing, setEditing] = useState(false)
  // 기록 화면에서 몇 건째부터 보고 있나. 최신이 0 이다.
  const [logAt, setLogAt] = useState(0)
  // 도움말도 한 화면에 안 들어간다. 같은 손놀림으로 굴린다.
  const [helpAt, setHelpAt] = useState(0)
  // 상세는 위아래가 계정을 고르므로 PgUp PgDn 으로만 굴린다.
  const [detailAt, setDetailAt] = useState(0)
  const [message, setMessage] = useState(null)
  const [now, setNow] = useState(Date.now())

  // 탭을 옮기면 고치던 것을 닫는다. 다른 화면에서 좌우를 눌렀을 때 안 보이는
  // 값이 움직이면 안 된다. 기록도 맨 위로 되돌려 최신부터 보인다.
  useEffect(() => {
    setEditing(false)
    setLogAt(0)
    setHelpAt(0)
    setDetailAt(0)
  }, [graphMode])

  // 다른 계정의 상세는 맨 위부터 본다.
  useEffect(() => setDetailAt(0), [selected])

  // 카운트다운을 위해 1초마다 시각만 새로 잡는다.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  // ---- 백엔드의 상태 ----
  const allRows = snapshot?.accounts ?? []
  const policy = snapshot?.policy ?? null
  const activeIds = snapshot?.active ?? { claude: null, codex: null }
  const tip = snapshot?.advice ?? null
  const scored = snapshot?.scores ?? []
  const decision = snapshot?.decision ?? null
  const intervalMs = snapshot?.poll?.intervalMs ?? 120_000

  // 판단 기준은 모듈 전역이다. 일정 그림이 백엔드와 같은 기준으로 그려지게 채운다.
  const tuning = policy?.tuning
  useEffect(() => {
    if (tuning) applyTuning({ ...TUNING_DEFAULTS, ...tuning })
  }, [tuning])

  // 숨긴 계정은 펼쳐 볼 때만 목록에 나온다. 합계와 추천에서는 늘 빠진다.
  const rows = useMemo(
    () => allRows.filter((row) => showHidden || !row.hidden),
    [allRows, showHidden])

  // 마지막 한 시간의 실패. 자동 블록이 이것만 알리고 자세한 것은 기록 탭이 맡는다.
  const recentFailures = useMemo(() => {
    const since = now - 3_600_000
    return logEntries.filter((entry) => entry.at >= since
      && (entry.kind === 'error' || entry.ok === false)).length
  }, [logEntries, now])

  // 왼쪽 폭은 내용이 정한다. 비율로 잡으면 좁은 터미널에서 이름이 잘리고 넓은
  // 터미널에서는 빈 자리가 남는다. 오른쪽 그래프가 나머지를 다 쓴다.
  // 막대 줄은 들여쓰기 5, 창 이름 7, 막대, 퍼센트 5, 남은 시간 9 와 상자의 테두리
  // 둘에 패딩 둘로 이뤄진다. 폭이 모자라면 막대부터 줄여야 줄이 안 접힌다.
  const barWidth = Math.max(8, Math.min(26, columns - 30))
  // 합계 막대는 provider 마다 따로 서고, 숨긴 계정은 거기서 빠진다.
  const claudeRows = useMemo(
    () => rows.filter((row) => row.provider === 'claude' && !row.hidden),
    [rows])
  const codexRows = useMemo(
    () => rows.filter((row) => row.provider === 'codex' && !row.hidden),
    [rows])
  const totalRowsFor = useCallback(
    (provider) => (provider === 'codex' ? codexRows : claudeRows),
    [claudeRows, codexRows])

  /**
   * 위아래로 오갈 수 있는 자리를 화면에 그려지는 순서대로 늘어놓는다. provider
   * 가 바뀌는 자리마다 그 provider 의 합계 줄이 계정들 앞에 선다. 인덱스를
   * 더하고 빼는 식으로 옮기면 음수인 합계 자리를 건너뛰거나 두 번 들른다.
   */
  const stops = useMemo(() => {
    const list = []
    let previous = null
    rows.forEach((row, index) => {
      if (row.provider !== previous) {
        list.push(totalAt(row.provider))
        previous = row.provider
      }
      list.push(index)
    })
    return list
  }, [rows])

  const moveSelection = useCallback((step) => {
    setSelected((current) => {
      const at = stops.indexOf(current)
      // 고르고 있던 계정이 사라졌다. 맨 앞으로 되돌린다.
      if (at < 0) return stops[0] ?? TOTAL_AT.claude
      return stops[Math.min(stops.length - 1, Math.max(0, at + step))]
    })
  }, [stops])

  // 목록이 그래프와 나란히 설 때 필요한 폭. 내용이 정한다.
  const listWidth = useMemo(() => {
    const labelOf = (row) => (row.label ? row.label.length + 4 : 0)
    // 사유는 이름 옆에 붙고 그 뒤에 값의 시각이 온다. 고정 폭을 두면 사유가
    // 있는 계정에서 문장이 잘려 무엇을 해야 하는지가 사라지고, 사유가 없는
    // 동안에는 그 자리가 빈 채로 그래프를 좁힌다. 지금 붙어 있는 것에 맞춘다.
    const noteOf = (row) => (row.note ? cellWidth(row.note) + 14 : 11)
    // 머리글: 들여쓰기와 번호, 별표 자리, 이름, 요금제, 값이 낡은 사유
    const header = 5 + 2 + Math.max(0, ...rows.map((row) => row.email.length))
      + Math.max(0, ...rows.map(labelOf)) + Math.max(11, ...rows.map(noteOf))
    // 막대 줄: 들여쓰기, 창 이름, 막대, 퍼센트, 남은 시간
    const bar = 5 + 7 + barWidth + 5 + 9
    // 좌우 패딩 둘과 테두리 둘
    return Math.min(columns - 24, Math.max(header, bar) + 4)
  }, [rows, columns, barWidth])

  // 그래프 상자의 테두리와 패딩 넷을 뺀 나머지가 그래프에 돌아간다. 모자라면
  // 좁은 배치다. 상자 하나가 폭을 다 쓰고, 목록은 '계정' 탭으로 들어간다.
  // 탭 줄이 늘 보이므로 어느 폭에서든 모든 탭에 닿는다.
  const wide = columns - listWidth - 4 >= MIN_GRAPH_WIDTH
  const tabs = wide ? GRAPH_TABS : [ACCOUNTS_TAB, ...GRAPH_TABS]
  // 넓어지면 '계정' 탭이 없다. 목록이 왼쪽에 늘 서 있으므로 사용량을 그린다.
  const mode = wide && graphMode === 'accounts' ? 'level' : graphMode
  const adviceCompact = screenRows < TIGHT_ROWS
  const panelWidth = wide ? listWidth : columns
  // 탭이 있는 상자(좁으면 유일한 상자)의 안쪽 폭. 테두리 둘과 패딩 둘을 뺀다.
  const graphWidth = (wide ? columns - panelWidth : columns) - 4
  const tabView = tabWindow(tabs, mode, graphWidth)
  const actionRows = actionLines(actionsFor(Boolean(snapshot?.update?.available)), columns)
  // 좁은 화면에서 계정을 대상으로 그리는 탭은 대상 줄 하나를 더 쓴다.
  const showTarget = !wide && TARGETED.has(mode)

  // ---- 알림과 요청 ----

  const messageTimer = useRef(null)
  const notify = useCallback((text) => {
    setMessage(text)
    // 상시로 띄워 두는 화면이라 눈이 늘 여기 있지 않다. 짧으면 놓친다.
    // 타이머는 하나만 둔다. 겹치면 앞 것이 새 메시지를 먼저 지운다.
    clearTimeout(messageTimer.current)
    messageTimer.current = setTimeout(() => setMessage(null), 8000)
  }, [])
  useEffect(() => () => clearTimeout(messageTimer.current), [])

  /**
   * 백엔드에 보낸다. 기다리는 동안 무엇을 기다리는지 적고, 끝나면 결과나
   * 백엔드가 준 거절 사유를 그대로 띄운다. 판정은 백엔드가 한다.
   */
  const send = useCallback(async (method, params = {}, { pending, done, timeoutMs } = {}) => {
    if (pending) notify(pending)
    try {
      const result = await request(method, params, timeoutMs ? { timeoutMs } : {})
      if (done) notify(typeof done === 'function' ? done(result) : done)
      return result
    } catch (error) {
      notify(error.message)
      return undefined
    }
  }, [request, notify])

  const selectedRow = selected >= 0 ? rows[selected] : null

  const doRefresh = useCallback(() => send('refresh', {}, {
    pending: '전체 재조회 중',
    done: (result) => (result?.ok === false ? `조회 실패: ${result.error}` : '전체 재조회 완료'),
  }), [send])

  const doToken = useCallback(() => {
    if (!selectedRow) return notify('계정을 먼저 고르세요')
    return send('refreshToken', { accountId: selectedRow.id }, {
      pending: `토큰 갱신 중: ${selectedRow.email}`,
      done: `토큰 갱신 완료: ${selectedRow.email}`,
    })
  }, [selectedRow, send, notify])

  const switchToSelected = useCallback(() => {
    if (!selectedRow) return notify('계정을 먼저 고르세요')
    return send('switch', { accountId: selectedRow.id }, {
      pending: `계정 전환 중: ${selectedRow.email}`,
      done: `계정 전환 완료: ${selectedRow.email}`,
    })
  }, [selectedRow, send, notify])

  const toggleHidden = useCallback(() => {
    if (!selectedRow) return notify('계정을 먼저 고르세요')
    return send('setHidden', { accountId: selectedRow.id, hidden: !selectedRow.hidden }, {
      done: selectedRow.hidden ? `숨김 해제: ${selectedRow.email}` : `숨김: ${selectedRow.email}`,
    })
  }, [selectedRow, send, notify])

  const togglePolicy = useCallback((key, onText, offText) => {
    if (!policy) return undefined
    const next = !policy[key]
    return send('setPolicy', { [key]: next }, { done: next ? onText : offText })
  }, [policy, send])

  /** 값을 한 칸 옮긴다. 0 이면 기본값으로. 범위를 넘으면 백엔드가 거절한다. */
  const nudgeKey = useCallback((key, direction) => {
    if (!policy || !key) return undefined
    const row = SETTINGS_ROWS.find((entry) => entry.key === key)
    if (row?.toggle) {
      const next = direction === 0 ? row.fallback : !policy[key]
      return send('setPolicy', { [key]: next })
    }
    const item = TUNABLES.find((entry) => entry.key === key)
    if (!item) return undefined
    if (direction === 0) return send('resetTuning', { key }, { done: `${item.label} 기본값` })
    return send('setTuning', { key, value: policy.tuning[key] + item.step * direction })
  }, [policy, send])
  const nudge = useCallback((direction) => nudgeKey(SETTINGS_ROWS[tuneAt]?.key, direction), [nudgeKey, tuneAt])
  const nudgeWeight = useCallback((direction) => nudgeKey(WEIGHT_KEYS[scoreAt], direction), [nudgeKey, scoreAt])

  /**
   * 업데이트. 받을 것이 있으면 한 번 더 눌러야 받는다. 백엔드가 받고 다시 뜨면
   * 화면도 새 코드로 다시 뜬다. 받을 것이 없다고 알고 있으면 지금 다시 확인한다.
   */
  const updateAt = useRef(0)
  const doUpdate = useCallback(async () => {
    if (hello && hello.source !== 'launchd') {
      // 직접 띄운 백엔드는 받은 뒤 다시 뜨지 않아 화면이 붙을 곳을 잃는다.
      notify('수동 실행 백엔드는 여기서 업데이트하지 않습니다. 터미널에서 orca-usage update 뒤 다시 실행하세요')
      return
    }
    const info = snapshot?.update
    if (!info?.available) {
      updateAt.current = 0
      const checked = await send('checkUpdate', {}, { pending: '업데이트 확인 중', timeoutMs: 60_000 })
      if (!checked) return
      if (checked.available) {
        updateAt.current = Date.now()
        notify(`업데이트 있음 ${checked.installed} -> ${checked.latest}. u 를 한 번 더 누르면 받고 재시작합니다`)
      } else {
        notify(checked.error ? `업데이트 확인 실패: ${checked.error}` : '최신 버전입니다')
      }
      return
    }
    if (Date.now() - updateAt.current > CONFIRM_WINDOW_MS) {
      updateAt.current = Date.now()
      notify(`업데이트 ${info.installed} -> ${info.latest}. u 를 한 번 더 누르면 받고 재시작합니다`)
      return
    }
    updateAt.current = 0
    await send('update', {}, {
      pending: '업데이트 받는 중',
      timeoutMs: 300_000,
      done: (applied) => (applied?.changed
        ? `업데이트 ${applied.from} -> ${applied.to}. 백엔드 재시작 뒤 화면도 재시작합니다`
        : '받을 업데이트 없음'),
    })
  }, [snapshot, hello, send, notify])

  // 백엔드가 다른 버전으로 바뀌면 화면도 새 코드로 다시 뜬다(follow-backend.js).
  const firstVersion = useRef(null)
  useEffect(() => {
    if (!hello) return
    firstVersion.current ??= hello.version
    if (needsScreenRestart(firstVersion.current, hello.version, SCREEN_VERSION)) {
      onRestart()
      exit()
    }
  }, [hello, onRestart, exit])

  /** 탭을 한 칸 옮긴다. 끝에서는 반대편으로 돈다. */
  const stepTab = useCallback((direction) => {
    setGraphMode((value) => {
      const shown = wide && value === 'accounts' ? 'level' : value
      const at = Math.max(0, tabs.findIndex((tab) => tab.mode === shown))
      return tabs[(at + direction + tabs.length) % tabs.length].mode
    })
  }, [wide, tabs])

  // 좁은 화면으로 켜면 목록부터 보인다. 넓은 화면의 첫 모습과 같은 것이 먼저다.
  const placed = useRef(false)
  useEffect(() => {
    if (placed.current || !snapshot) return
    placed.current = true
    if (!wide) setGraphMode('accounts')
  }, [snapshot, wide])

  // Ctrl+C 와 Esc 는 되묻는다. 둘 다 다른 일을 하다 손이 미끄러지기 쉬운 자리이고,
  // Esc 는 알 수 없는 이스케이프 시퀀스가 들어와도 눌린 것처럼 보인다.
  const quitAt = useRef(0)

  const runAction = useCallback((key) => {
    if (key === 'r') doRefresh()
    else if (key === 't') doToken()
    else if (key === 'x') toggleHidden()
    else if (key === 'X') setShowHidden((value) => !value)
    else if (key === 'o') {
      togglePolicy('keepAlive',
        '창 미리 열기 켬: 닫힌 5h, 7d 창을 요청 하나로 엽니다',
        '창 미리 열기 끔: 안 쓰는 계정의 리셋 시계가 멈춥니다')
    } else if (key === 'a') {
      togglePolicy('autoSwitch',
        `자동 전환 켬: 사용 중 계정이 ${policy?.tuning.switchAt}% 를 넘고 다른 계정이 ${policy?.tuning.switchMargin}%p 이상 여유로우면 전환합니다`,
        '자동 전환 끔: 계정 전환은 Enter 로만 합니다')
    } else if (key === 'w') {
      setRangeIndex((value) => {
        const next = (value + 1) % RANGES.length
        notify(`기간: ${RANGES[next].label}`)
        return next
      })
    } else if (key === 'u') doUpdate()
    else if (key === 'q') exit()
  }, [doRefresh, doToken, toggleHidden, togglePolicy, doUpdate, policy, notify, exit])

  // ---- 배치 ----

  // 화면을 위에서부터 쌓아 클릭 좌표를 행으로 되짚는다. 액션 바는 항상 맨 아래다.
  const layout = useMemo(() => {
    // 상자 높이는 화면에 맞춘다. 내용만큼 커지게 두면 계정이 많을 때 상자가
    // 화면을 넘어 아래 테두리가 잘린 채로 남는다.
    const panelHeight = Math.max(6, screenRows - HEADER_ROWS - actionRows.length)
    const graphHeight = Math.max(4, panelHeight - 2)
    return {
      panelWidth,
      panelHeight,
      // 그래프는 그 상자에서 테두리 두 줄을 뺀 만큼이다. 따로 재면 상자를 넘는다.
      graphHeight,
      // 탭 줄과, 좁은 화면이면 대상 줄을 뺀 본문 높이.
      bodyHeight: Math.max(3, graphHeight - 1 - (showTarget ? 1 : 0)),
    }
  }, [panelWidth, screenRows, actionRows.length, showTarget])

  useInput((input, key) => {
    // 마우스 리포팅을 켜 두면 클릭 좌표가 `[<0;100;12M` 같은 문자열로 여기
    // 들어온다. 글자별로 훑으면 좌표의 숫자가 계정 선택으로 읽혀, 그래프 아무
    // 데나 눌러도 계정이 바뀐다. 클릭으로 처리하고 아래로 넘기지 않는다.
    if (isMouseSequence(input)) {
      const click = parseMouseClick(input)
      if (click) onClick(click.row, click.column)
      return
    }
    // 설정과 판정은 좌우로 값을 옮기는 화면이다. 그 좌우는 패널을 옮기는 키와
    // 같으므로, Enter 로 한 번 들어와야 값이 움직인다.
    const tunes = mode === 'settings' || mode === 'score'
    const tuningNow = tunes && editing
    // 기록과 도움말은 한 화면에 다 안 들어간다. 위아래가 목록 대신 이쪽을 굴린다.
    const logRows = logVisibleRows(layout.bodyHeight)
    const maxLog = Math.max(0, logEntries.length - logRows)
    const helpBody = helpVisibleRows(layout.bodyHeight)
    const maxHelp = Math.max(0, helpRows(graphWidth).length - helpBody)
    const maxDetail = mode === 'detail'
      ? Math.max(0, detailLines({
        row: selectedRow, rows, history, log: logEntries, now, staleAfterMs: intervalMs * 4,
      }).length - layout.bodyHeight)
      : 0

    if (key.escape || (key.ctrl && input === 'c')) {
      // 고치던 중이면 그것부터 닫는다. 종료를 되묻는 것은 그다음이다.
      if (key.escape && tuningNow) return setEditing(false)
      const at = Date.now()
      if (at - quitAt.current < CONFIRM_WINDOW_MS) return exit()
      quitAt.current = at
      return notify('한 번 더 누르면 종료합니다. q 는 바로 종료합니다')
    }

    /** 값을 고치는 화면이면 수정모드를 여닫고, 아니면 고른 계정으로 옮긴다. */
    const enter = () => {
      if (!tunes) return switchToSelected()
      setEditing((value) => {
        if (!value) notify('수정 중: 좌우로 값 변경, Enter 나 Esc 로 종료')
        return !value
      })
      return undefined
    }
    /** 값을 한 칸 옮긴다. 어느 화면인지에 따라 대상이 갈린다. */
    const nudgeHere = (direction) => (mode === 'settings' ? nudge(direction) : nudgeWeight(direction))
    /** 위아래가 무엇을 옮기는지는 지금 보고 있는 패널이 정한다. */
    const step = (direction) => {
      if (mode === 'settings') {
        return setTuneAt((at) => Math.min(SETTINGS_ROWS.length - 1, Math.max(0, at + direction)))
      }
      if (mode === 'score') {
        return setScoreAt((at) => Math.min(WEIGHT_KEYS.length - 1, Math.max(0, at + direction)))
      }
      if (mode === 'log') return setLogAt((at) => Math.min(maxLog, Math.max(0, at + direction)))
      if (mode === 'help') return setHelpAt((at) => Math.min(maxHelp, Math.max(0, at + direction)))
      return moveSelection(direction)
    }

    if (key.return) return enter()
    if (key.leftArrow) return tuningNow ? nudgeHere(-1) : stepTab(-1)
    if (key.rightArrow) return tuningNow ? nudgeHere(1) : stepTab(1)
    // 기록은 500건까지 쌓인다. 한 줄씩으로는 지난주에 닿지 못한다.
    const page = mode === 'log' ? logRows : mode === 'help' ? helpBody : 1
    if (mode === 'detail' && (key.pageDown || key.pageUp)) {
      const jump = Math.max(1, layout.bodyHeight - 1) * (key.pageDown ? 1 : -1)
      return setDetailAt((at) => Math.min(maxDetail, Math.max(0, at + jump)))
    }
    if (key.pageDown) return step(page)
    if (key.pageUp) return step(-page)
    if (key.downArrow) return step(1)
    if (key.upArrow) return step(-1)
    // 빠른 연타나 붙여넣기는 여러 글자가 한 번에 들어온다. 글자마다 처리해야
    // 'rw' 같은 입력이 통째로 버려지지 않는다.
    for (const char of input) {
      // 여러 글자가 한 입력에 실려 오면 ink 가 특수키 판정을 하지 않는다.
      // 개행도 여기서 직접 받아야 엔터가 묻히지 않는다.
      if (char === '\r' || char === '\n') enter()
      else if (tuningNow && 'hl0'.includes(char)) {
        if (char === 'h') nudgeHere(-1)
        else if (char === 'l') nudgeHere(1)
        else nudgeHere(0)
      } else if (char === 'j') step(1)
      else if (char === 'k') step(-1)
      else if (char === '0') setSelected(stops[0] ?? TOTAL_AT.claude)
      else if (char >= '1' && char <= '9') {
        // 화면에 적힌 번호로 찾는다. 배열 위치로 세면 숨긴 계정이 있을 때
        // 눌린 숫자와 골라지는 계정이 어긋난다.
        const at = rows.findIndex((row) => row.index === Number(char))
        if (at >= 0) setSelected(at)
      } else if ('rtqwaoxXu'.includes(char)) runAction(char)
    }
    return undefined
  })

  // 각 항목이 자기 위치를 알려 온다. 행을 손으로 세지 않으므로 창을 접거나
  // 계정이 늘어도 따로 맞출 것이 없다.
  const hits = useRef(new Map())
  const columnTop = useRef(0)
  const onHit = useCallback((id, top, height) => {
    if (top == null) hits.current.delete(id)
    else hits.current.set(id, { top, height })
  }, [])
  const onColumnTop = useCallback((top) => {
    columnTop.current = top
  }, [])

  /**
   * 세로가 모자랄 때 그릴 구간.
   *
   * 넘치는 만큼은 어차피 잘린다. 고른 계정이 그 잘린 자리에 있으면 무엇을 보고
   * 있는지도, 왜 그래프가 그 계정인지도 알 수 없으므로 그 계정이 들어오도록
   * 민다. 시작점은 되도록 지킨다. 고를 때마다 그 행을 맨 위로 올리면 위쪽
   * 계정은 영영 안 보이고, 클릭한 행이 튀어 올라 같은 자리를 두 번 누르면
   * 다른 계정이 잡힌다.
   */
  const viewStart = useRef(0)
  const view = useMemo(() => {
    const count = rows.length
    if (count === 0) return { start: 0, end: 0 }
    const blocks = rows.map((row) => blockHeight(row))
    const isHead = (index) => index === 0 || rows[index].provider !== rows[index - 1].provider
    // 구간이 차지하는 줄 수. 첫 행에는 늘 합계 블록이 붙고 안쪽은 provider 가
    // 바뀔 때 붙는다. 렌더가 그리는 규칙과 같아야 한다.
    const headRows = (index) => totalBarsHeight(totalRowsFor(rows[index].provider))
    // 구간의 마지막 블록은 빈 줄 없이 그린다(AccountBlock 의 gap).
    const rowsIn = (start, end) => {
      let sum = -1
      for (let index = start; index < end; index += 1) {
        sum += blocks[index] + (index === start || isHead(index) ? headRows(index) : 0)
      }
      return sum
    }
    // 좁은 화면에서는 목록이 탭 줄 아래에 선다.
    const budget = layout.panelHeight - 2 - (wide ? 0 : 1)
      - adviceHeight(adviceCompact) - AUTO_BLOCK_ROWS
    if (rowsIn(0, count) <= budget) {
      viewStart.current = 0
      return { start: 0, end: count }
    }

    const target = Math.min(count - 1, Math.max(0, selected))
    const endFrom = (start) => {
      let end = start + 1
      while (end < count && rowsIn(start, end + 1) <= budget) end += 1
      return end
    }
    let start = Math.min(viewStart.current, target)
    let end = endFrom(start)
    if (target >= end) {
      // 아래로 나갔다. 고른 행이 마지막에 오도록 시작을 민다.
      end = target + 1
      start = target
      while (start > 0 && rowsIn(start - 1, end) <= budget) start -= 1
    }
    viewStart.current = start
    return { start, end }
  }, [rows, selected, totalRowsFor, adviceCompact, layout.panelHeight, wide])

  const onClick = useCallback((row, column) => {
    // 마우스는 1 부터 세고 배치 좌표는 0 부터 센다.
    const y = row - 1 - columnTop.current
    // ink 의 overflow 는 그리기만 자르고 배치는 그대로라, 상자 밖으로 밀린 블록도
    // 좌표를 갖는다. 아래 테두리와 액션 바를 눌러 안 보이는 계정이 잡히면 안 된다.
    if (y >= layout.panelHeight - 1) return
    // 탭 줄. 행은 재 둔 것을 쓰고, 열은 탭 줄을 그린 것과 같은 계산(bars.js)으로
    // 가른다. 테두리와 패딩을 세어 맞추면 상자 모양이 바뀔 때마다 어긋난다.
    const tabRow = hits.current.get(TAB_HIT)
    const tabBoxLeft = wide ? layout.panelWidth : 0
    if (tabRow && y >= tabRow.top && y < tabRow.top + tabRow.height && column > tabBoxLeft) {
      const at = column - 1 - tabBoxLeft - 2
      const tab = tabView.items.find((range) => at >= range.start && at < range.end)
      if (tab) setGraphMode(tab.mode)
      return
    }
    // 넓으면 목록은 왼쪽 상자에, 좁으면 계정 탭에만 있다.
    if (wide ? column > layout.panelWidth : mode !== 'accounts') return
    for (const [id, box] of hits.current) {
      if (id === TAB_HIT) continue
      if (y >= box.top && y < box.top + box.height) {
        setSelected(() => id)
        return
      }
    }
  }, [layout.panelWidth, layout.panelHeight, wide, mode, tabView])

  useMouseReporting()

  const current = selectedRow
  // 합계 줄을 고르고 있을 때 그릴 전체 그래프. 고른 줄의 provider 를 따른다.
  const overviewProvider = TOTAL_PROVIDER[selected] ?? 'claude'

  const header = <Header status={status} snapshot={snapshot} hello={hello} now={now} message={message} />
  if (!snapshot) {
    return (
      <Box flexDirection="column" height={screenRows} width={columns}>
        {header}
        <Text color="gray">{'  백엔드 연결 중'}</Text>
      </Box>
    )
  }
  if (allRows.length === 0) {
    return (
      <Box flexDirection="column" height={screenRows} width={columns}>
        {header}
        <Text color="red">{'  Orca 계정 없음. Orca 에 로그인한 계정이 있는지 확인하세요'}</Text>
      </Box>
    )
  }

  // 계정 목록. 넓으면 왼쪽 상자에, 좁으면 '계정' 탭에 들어간다.
  const listBody = (
    <>
      {rows.slice(view.start, view.end).map((row, offset) => {
        const index = view.start + offset
        return (
          <React.Fragment key={row.id}>
            {index === view.start || row.provider !== rows[index - 1]?.provider
              ? (
                <Hit id={totalAt(row.provider)} onMeasure={onHit}>
                  <TotalBars
                    rows={totalRowsFor(row.provider)}
                    label={PROVIDER_LABEL[row.provider] ?? row.provider}
                    width={panelWidth - 4}
                    now={now}
                    selected={selected === totalAt(row.provider)}
                  />
                </Hit>
                )
              : null}
            <Hit id={index} onMeasure={onHit}>
              <AccountBlock
                row={row}
                active={row.id === activeIds[row.provider]}
                dimmed={Boolean(row.hidden)}
                selected={index === selected}
                now={now}
                barWidth={barWidth}
                staleAfterMs={intervalMs * 4}
                gap={index !== view.end - 1}
              />
            </Hit>
          </React.Fragment>
        )
      })}
      <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
        <Advice tip={tip} compact={adviceCompact} />
        <AutoBlock
          poll={snapshot.poll}
          orcaConnected={snapshot.orca?.connected}
          keepAlive={policy?.keepAlive}
          autoSwitch={policy?.autoSwitch}
          failures={recentFailures}
          now={now}
        />
      </Box>
    </>
  )

  const bodyHeight = layout.bodyHeight
  const panelBody = mode === 'accounts'
    ? listBody
    : mode === 'score'
      ? (
        <Score
          scored={scored}
          activeId={activeIds.claude}
          useId={tip?.use?.row.id}
          decision={decision}
          selected={scoreAt}
          editing={editing}
          height={bodyHeight}
          columns={graphWidth}
        />
        )
      : mode === 'settings'
        ? (
          <Settings
            values={policy?.tuning ?? TUNING_DEFAULTS}
            policy={policy}
            selected={tuneAt}
            editing={editing}
            height={bodyHeight}
            columns={graphWidth}
          />
          )
        : mode === 'help'
          ? <Help offset={helpAt} height={bodyHeight} columns={graphWidth} />
          : mode === 'log'
            ? <Log entries={logEntries} now={now} offset={logAt} height={bodyHeight} columns={graphWidth} />
            : mode === 'detail'
              ? (
                <Details
                  row={current}
                  rows={rows}
                  history={history}
                  log={logEntries}
                  now={now}
                  height={bodyHeight}
                  columns={graphWidth}
                  staleAfterMs={intervalMs * 4}
                  offset={detailAt}
                />
                )
              : mode === 'schedule'
                ? <Schedule rows={claudeRows} historyById={history} now={now} height={bodyHeight} columns={graphWidth} />
                : current
                  ? (
                    <Graph
                      row={current}
                      history={history[current.id] ?? []}
                      columns={graphWidth}
                      height={bodyHeight}
                      mode={mode}
                      rangeMs={RANGES[rangeIndex].ms}
                      rangeLabel={RANGES[rangeIndex].label}
                      style={graphStyle}
                    />
                    )
                  : (
                    <OverviewGraph
                      accounts={totalRowsFor(overviewProvider)}
                      label={PROVIDER_LABEL[overviewProvider]}
                      historyById={history}
                      columns={graphWidth}
                      height={bodyHeight}
                      mode={mode}
                      rangeMs={RANGES[rangeIndex].ms}
                      rangeLabel={RANGES[rangeIndex].label}
                      style={graphStyle}
                    />
                    )

  const lostColor = status === 'lost' ? 'yellow' : null
  return (
    <Box flexDirection="column" height={screenRows} width={columns}>
      {header}
      <HitRoot onMeasure={onColumnTop} flexGrow={1} flexDirection="row">
        {/* 왼쪽은 flexShrink 를 막는다. 오른쪽 내용이 길면 flex 가 이쪽을 눌러
            막대와 이름이 잘리는데, 폭은 목록이 필요로 하는 만큼이라 내줄 자리가
            없다. */}
        {wide ? (
          <Box
            width={panelWidth}
            height={layout.panelHeight}
            flexShrink={0}
            flexDirection="column"
            borderStyle="round"
            borderColor={lostColor ?? 'gray'}
            paddingX={1}
            overflow="hidden"
          >
            {listBody}
          </Box>
        ) : null}
        <Box
          flexGrow={1}
          height={layout.panelHeight}
          flexDirection="column"
          borderStyle="round"
          borderColor={lostColor ?? 'cyan'}
          paddingX={1}
          overflow="hidden"
        >
          <Hit id={TAB_HIT} onMeasure={onHit}>
            <Tabs view={tabView} mode={mode} />
          </Hit>
          {showTarget ? <TargetLine row={current} provider={overviewProvider} /> : null}
          {panelBody}
        </Box>
      </HitRoot>
      <ActionBar lines={actionRows} />
    </Box>
  )
}
