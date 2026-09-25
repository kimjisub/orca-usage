import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { collectAccounts, collectAllAccounts } from '../adapters/orca/accounts.js'
import { advise, scoreAccounts } from '../core/advice.js'
import { decideSwitch } from '../core/autoswitch.js'
import { RANGES } from './chart.js'
import { activeAccountIds, selectClaudeAccount } from '../adapters/orca/orca-rpc.js'
import { selectCodexAccount } from '../adapters/orca/orca-limits.js'
import { loadSettings, saveSettings } from '../adapters/store/settings.js'
import { TUNABLES, TUNING_DEFAULTS, applyTuning, tuning } from '../core/tuning.js'
import { cellWidth, shortSpan } from '../core/format.js'
import { useFullscreen } from './fullscreen.js'
import { isMouseSequence, parseMouseClick, useMouseReporting } from './mouse.js'
import { pollOnce, rowsFromCache } from '../engine/poller.js'
import { createPorts } from '../daemon/ports.js'

const PORTS = createPorts()
import { loadHistory } from '../adapters/store/store.js'
import { AccountBlock, blockHeight } from './AccountBlock.jsx'
import { TotalBars, totalBarsHeight } from './TotalBars.jsx'
import { AUTO_BLOCK_ROWS, Advice, AutoBlock, Graph, OverviewGraph, adviceHeight } from './Graph.jsx'
import { Hit, HitRoot } from './Hit.jsx'
import { Schedule } from './Schedule.jsx'
import { Log, logVisibleRows } from './Log.jsx'
import { Settings } from './Settings.jsx'
import { Help, helpRows, helpVisibleRows } from './Help.jsx'
import { Score } from './Score.jsx'
import { log, loadLog } from '../adapters/store/log.js'
import { openWindow } from '../adapters/keychain/keepalive.js'
import { REFRESH_AFTER_EXPIRY_MS, needsOpening } from '../core/policy.js'

const HEADER_ROWS = 2
// 활성 계정만 따로 확인하는 주기. 사용량 조회와 달리 소켓 한 번이라 가볍고,
// Orca 에서 손으로 바꾼 것이 화면에 늦게 뜨면 어느 계정으로 도는지 헷갈린다.
const ACTIVE_POLL_MS = 5000
// 종료를 되묻는 시간. 이 안에 다시 누르면 끝낸다.
const QUIT_WINDOW_MS = 3000
// 섹션 머리글. 계정 수와 창 구조가 provider 마다 달라 목록을 갈라 세운다.
const PROVIDER_LABEL = { claude: 'Claude', codex: 'Codex' }
// 합계 줄이 앉는 선택 자리. 계정은 0 부터라 음수를 쓰고, 탭 줄(-2)을 비켜 간다.
const TOTAL_AT = { claude: -1, codex: -3 }
const TOTAL_PROVIDER = { '-1': 'claude', '-3': 'codex' }
const totalAt = (provider) => TOTAL_AT[provider] ?? TOTAL_AT.claude
// 오른쪽 패널이 보여줄 것. d 가 이 순서로 돌고 탭도 이 순서다.
const GRAPH_TABS = [
  { mode: 'level', label: '사용량' },
  { mode: 'rate', label: '소비' },
  { mode: 'schedule', label: '일정' },
  { mode: 'score', label: '판정' },
  { mode: 'log', label: '기록' },
  { mode: 'settings', label: '설정' },
  { mode: 'help', label: '도움말' },
]
// 그래프 상자 안쪽이 이보다 좁으면 그래프를 접고 목록이 폭을 다 쓴다. 눈금
// 여섯 칸을 빼고 서른 칸은 있어야 선이 형태를 갖춘다. 화면 폭이 아니라 목록이
// 쓰고 남는 칸으로 재는 이유는, 목록 폭이 긴 이메일을 따라 늘기 때문이다.
const MIN_GRAPH_WIDTH = 36
// 이보다 낮으면 모델별 창을 접고 추천도 첫 줄만 남긴다. 계정마다 한 줄씩 벌어
// 계정 수가 더 들어간다.
const TIGHT_ROWS = 30
// 라벨을 짧게 둔다. 한 줄에 다 실려야 해서 길면 통째로 밀린다. 패널 이동은
// 좌우 화살표와 탭 클릭이라 키가 없다.
const ACTIONS = [
  { key: 'r', label: '전체 재조회' },
  { key: 't', label: '토큰 갱신' },
  { key: 'a', label: '자동 전환' },
  { key: 'o', label: '창 미리 열기' },
  { key: 'w', label: '기간' },
  { key: 'x', label: '숨기기' },
  { key: 'enter', label: '계정 전환' },
  { key: 'q', label: '종료' },
]

function Header({ nextPollAt, busy, now, message, autoSwitch, direct }) {
  const right = busy
    ? '조회 중'
    : nextPollAt ? `다음 조회 ${shortSpan(nextPollAt - now)}` : ''
  return (
    <>
      {/* 좁은 화면에서 두 덩이가 맞물려 접히면 머리글이 두 줄을 먹는다. */}
      <Box justifyContent="space-between" paddingX={1} flexShrink={0}>
        <Text wrap="truncate">
          <Text color="white" bold>{'watching all accounts'}</Text>
          {message ? <Text color="yellow">{`   ${message}`}</Text> : null}
        </Text>
        <Text wrap="truncate">
          {/* Orca 없이 직접 치는 중이면 알린다. 값이 낡거나 백오프에 걸릴 수 있어서다. */}
          {direct ? <Text color="yellow">{'Orca 연결 안 됨, 직접 조회  '}</Text> : null}
          {autoSwitch ? <Text color="green" bold>{'자동 전환  '}</Text> : null}
          <Text color="gray">{right}</Text>
        </Text>
      </Box>
      <Text> </Text>
    </>
  )
}

function ActionBar() {
  return (
    <Text wrap="truncate">
      {'  '}
      {ACTIONS.map((action) => (
        <Text key={action.key}>
          <Text color="cyan">{`[${action.key}]`}</Text>
          <Text color="gray">{` ${action.label}  `}</Text>
        </Text>
      ))}
    </Text>
  )
}

// 탭 줄의 클릭 좌표를 재는 자리. 계정 번호와 안 겹치는 값이면 된다.
const TAB_HIT = -2

// 탭 줄의 머리. 여기부터 탭이 늘어선다. 좌우 화살표로 옮긴다는 것을 적어 둔다.
const TAB_LEAD = ' <> '

/**
 * 탭이 차지하는 열 범위. 클릭한 자리가 어느 탭인지 여기서 가른다.
 *
 * 고른 탭은 대괄호, 나머지는 공백이라 폭이 같다. 그래서 무엇을 고르든 자리가
 * 움직이지 않고, 렌더와 이 계산이 어긋날 일도 없다.
 */
const TAB_RANGES = (() => {
  let at = cellWidth(TAB_LEAD)
  return GRAPH_TABS.map((tab) => {
    const width = cellWidth(tab.label) + 3
    const range = { mode: tab.mode, start: at, end: at + width }
    at += width
    return range
  })
})()

// 탭 일곱이 다 들어가려면 이만큼 필요하다.
const TAB_ROW_WIDTH = TAB_RANGES.at(-1)?.end ?? 0

/**
 * 오른쪽 패널의 탭. 무엇을 볼 수 있고 지금 어디인지 한 줄로 보인다. 눌러도 바뀐다.
 *
 * 폭이 모자라면 뒤쪽 탭이 통째로 잘려 무엇이 더 있는지조차 안 보인다. 그때는
 * 고른 것 하나와 몇 번째인지만 남긴다.
 */
function GraphTabs({ mode, width }) {
  const at = GRAPH_TABS.findIndex((tab) => tab.mode === mode)
  if (width < TAB_ROW_WIDTH) {
    return (
      <Text wrap="truncate">
        <Text color="gray">{TAB_LEAD}</Text>
        <Text color="cyan" bold>{`[${GRAPH_TABS[at]?.label ?? ''}]`}</Text>
        <Text color="gray">{`  ${at + 1}/${GRAPH_TABS.length}`}</Text>
      </Text>
    )
  }
  return (
    <Text wrap="truncate">
      <Text color="gray">{TAB_LEAD}</Text>
      {GRAPH_TABS.map((tab) => (
        <Text key={tab.mode} color={tab.mode === mode ? 'cyan' : 'gray'} bold={tab.mode === mode}>
          {tab.mode === mode ? ` [${tab.label}]` : `  ${tab.label} `}
        </Text>
      ))}
    </Text>
  )
}

export function App({ intervalMs, allowRefresh, graphStyle = 'braille' }) {
  const { exit } = useApp()
  const { columns, rows: screenRows } = useFullscreen()

  const saved = useMemo(() => loadSettings(), [])
  // Claude 는 디렉터리를 읽으면 끝이라 첫 프레임에 바로 세운다. Codex 는 Orca 에
  // 물어야 해서 곧이어 합류한다. 기다렸다 함께 그리면 첫 화면이 그만큼 늦다.
  const [accounts, setAccounts] = useState(() => collectAccounts())
  const [accountsReady, setAccountsReady] = useState(false)
  const [allRows, setAllRows] = useState(() => rowsFromCache(accounts, PORTS.store))
  // 숨긴 계정. 조회와 기록은 그대로 두고 화면과 판단에서만 뺀다. 다시 꺼냈을 때
  // 히스토리가 끊겨 있으면 그래프가 그 구간만 비어 보인다.
  const [hiddenIds, setHiddenIds] = useState(() => saved.hiddenIds)
  const [showHidden, setShowHidden] = useState(false)
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds])
  const rows = useMemo(
    () => allRows
      .filter((row) => showHidden || !hidden.has(row.id))
      .map((row) => (hidden.has(row.id) ? { ...row, hidden: true } : row)),
    [allRows, hidden, showHidden])
  // 어느 계정에 붙어 있는지는 Orca 만 안다. 행마다 박아 두면 일부만 갱신했을 때
  // 옛 표시가 남아 별표가 둘이 된다. 한 곳에 두고 화면이 그때그때 비교한다.
  const [activeIds, setActiveIds] = useState(
    () => ({ claude: accounts.find((account) => account.active)?.id ?? null, codex: null }))
  // poll 안에서 읽으므로 ref 로도 들고 있는다. 의존성에 넣으면 계정이 바뀔 때마다
  // 폴링 타이머가 통째로 다시 걸린다.
  const activeIdsRef = useRef(activeIds)
  useEffect(() => { activeIdsRef.current = activeIds }, [activeIds])

  const [history, setHistory] = useState(() => loadHistory())
  // 저장된 선택은 초기값에서 바로 정한다. effect 로 나중에 덮으면 그 사이에
  // 들어온 클릭이 되감긴다. 계정 id 로 찾으므로 목록이 바뀌어도 안전하다.
  const [selected, setSelected] = useState(() => {
    if (!saved.selectedId) return TOTAL_AT.claude
    // 합계 줄은 계정이 아니라 자리를 저장한다. 계정 id 와 섞이지 않게 접두를 붙인다.
    if (saved.selectedId.startsWith('totals:')) return totalAt(saved.selectedId.slice(7))
    const index = accounts.findIndex((account) => account.id === saved.selectedId)
    return index >= 0 ? index : -1
  })
  const [busy, setBusy] = useState(false)
  const [graphMode, setGraphMode] = useState(saved.graphMode)
  const [rangeIndex, setRangeIndex] = useState(saved.rangeIndex)
  // 기본은 꺼 둔다. 계정을 바꾸는 일이라 켜는 것은 사람이 정한다.
  const [autoSwitch, setAutoSwitch] = useState(saved.autoSwitch)
  // 창 유지. 안 쓰는 계정의 5h 창을 열어 두어 리셋 시계가 돌게 한다.
  const [keepAlive, setKeepAlive] = useState(saved.keepAlive)
  const keepAliveRef = useRef(false)
  useEffect(() => { keepAliveRef.current = keepAlive }, [keepAlive])
  // 계정별로 마지막에 창을 연 시각. 한 바퀴 안에 두 번 보내지 않는다.
  // 같은 것을 두 번 적지 않으려고 마지막으로 본 상태를 들고 있는다. 시작할 때
  // 캐시에 남아 있던 값은 지난 일이라 이미 본 것으로 친다. 그러지 않으면 앱을
  // 켤 때마다 옛 갱신 시각이 새 사건으로 찍힌다.
  const lastShape = useRef('')
  const refreshSeen = useRef(null)
  const authSeen = useRef(null)
  if (refreshSeen.current == null) {
    const seeded = rowsFromCache(accounts, PORTS.store)
    refreshSeen.current = new Map(seeded.filter((row) => row.refreshedAt).map((row) => [row.id, row.refreshedAt]))
    authSeen.current = new Set(seeded.filter((row) => row.authFailed).map((row) => row.id))
  }
  // 마지막으로 창을 연 결과. 자동 블록이 보인다.
  const [logEntries, setLogEntries] = useState(() => loadLog())
  // 설정 값과 지금 고른 항목. 값은 tuning 이 들고 있고 여기서는 화면을 다시 그리게
  // 하려고 사본을 둔다.
  const [tuned, setTuned] = useState(() => applyTuning(saved.tuning))
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
  // 폴링 안에서 읽으므로 ref 로도 들고 있는다. 의존성에 넣으면 기록이 쌓일 때마다
  // 폴링 타이머가 다시 걸린다.
  const logRef = useRef(logEntries)
  // 기록은 여러 곳에서 남긴다. 한 곳으로 모아 화면 갱신을 함께 처리한다.
  const note = useCallback((kind, text, detail) => {
    log(kind, text, detail)
    logRef.current = loadLog()
    setLogEntries(logRef.current)
  }, [])
  // 탭을 옮기면 고치던 것을 닫는다. 다른 화면에서 좌우를 눌렀을 때 안 보이는
  // 값이 움직이면 안 된다. 기록도 맨 위로 되돌려 최신부터 보인다.
  useEffect(() => {
    setEditing(false)
    setLogAt(0)
    setHelpAt(0)
  }, [graphMode])

  const lastSwitchAt = useRef(saved.lastSwitchAt)
  const switching = useRef(false)
  const [decision, setDecision] = useState(null)
  const [message, setMessage] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [nextPollAt, setNextPollAt] = useState(Date.now() + intervalMs)
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
  // 추천과 판정, 자동 전환은 Claude 안에서만 선다. Codex 는 창이 7d 하나뿐이라
  // 5h 를 보는 판단을 같은 자로 재면 빈 값이 된다. 합계 막대는 provider 마다
  // 따로 서므로 Codex 도 자기 창으로 집계된다.
  // 숨긴 계정은 펼쳐 보는 중에도 추천과 합계에서 빠진다. 숨겼다는 것은 쓰지
  // 않겠다는 뜻이라, 목록에 잠깐 꺼내 본다고 판단 대상이 되면 안 된다.
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

  // 설정은 건드리지 않는다. 창을 넓히면 접었던 것이 그대로 돌아와야 한다.
  // 그래프 상자의 테두리와 패딩 넷을 뺀 나머지가 그래프에 돌아간다.
  const graphFits = columns - listWidth - 4 >= MIN_GRAPH_WIDTH
  // 기록은 선이 아니라 글이라 좁은 화면에서도 읽힌다. 그래프 폭 조건을 안 건다.
  // 글로 된 패널은 선이 아니라서 좁아도 읽히지만, 좌우로 나눈 채로는 양쪽 다
  // 눌린다. 나란히 세울 자리가 없으면 고른 것 하나가 폭을 다 쓰고 계정 목록은
  // 그동안 접힌다. 사용량과 소비는 그래프라 접히던 대로 접힌다.
  const textPanel = ['schedule', 'score', 'log', 'settings', 'help'].includes(graphMode)
  const graphVisible = graphFits || textPanel
  const listVisible = graphFits || !graphVisible
  const adviceCompact = screenRows < TIGHT_ROWS
  const panelWidth = graphVisible && listVisible ? listWidth : columns
  // 오른쪽 상자 안쪽 폭. 테두리 둘과 패딩 둘을 뺀다.
  const graphWidth = (listVisible ? columns - panelWidth : columns) - 4

  const running = useRef(false)
  const timer = useRef(null)

  // Ctrl+C 와 Esc 는 되묻는다. 둘 다 다른 일을 하다 손이 미끄러지기 쉬운 자리이고,
  // Esc 는 알 수 없는 이스케이프 시퀀스가 들어와도 눌린 것처럼 보인다.
  const quitAt = useRef(0)
  const messageTimer = useRef(null)
  const notify = useCallback((text) => {
    setMessage(text)
    // 상시로 띄워 두는 화면이라 눈이 늘 여기 있지 않다. 짧으면 놓친다.
    // 타이머는 하나만 둔다. 겹치면 앞 것이 새 메시지를 먼저 지우고, 종료 뒤에도
    // 남은 타이머가 프로세스를 8초까지 붙들었다.
    clearTimeout(messageTimer.current)
    messageTimer.current = setTimeout(() => setMessage(null), 8000)
  }, [])

  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  // 첫 목록은 알릴 것이 없다. 그 뒤로 달라진 것만 말한다.
  const knownIds = useRef(null)

  /**
   * 계정 목록을 다시 세운다.
   *
   * Orca 에서 계정을 더하거나 뺀 것은 목록을 다시 읽어야 보인다. 첫 렌더에서
   * 한 번만 읽으면 앱을 껐다 켜기 전까지 새 계정이 화면에 없다.
   *
   * @returns {Promise<object[]|null>} 새 목록. 읽지 못했으면 null 이다.
   */
  const reloadAccounts = useCallback(async () => {
    let all
    try {
      all = await collectAllAccounts()
    } catch {
      return null // Orca 가 꺼져 있다. 들고 있던 목록을 그대로 쓴다.
    }
    if (!mounted.current) return null
    const ids = new Set(all.map((account) => account.id))
    if (knownIds.current) {
      const added = all.filter((account) => !knownIds.current.has(account.id))
      const gone = [...knownIds.current].filter((id) => !ids.has(id))
      if (added.length) {
        const names = added.map((account) => account.email).join(', ')
        note('poll', `계정 합류: ${names}`)
        notify(`계정 합류: ${names}`)
      }
      if (gone.length) note('poll', `계정 ${gone.length}개가 목록에서 빠짐`)
    }
    knownIds.current = ids
    setAccounts(all)
    // 그 사이 폴링이 채운 값을 지우지 않는다. 새로 합류한 계정만 캐시에서 온다.
    setAllRows((previous) => {
      const known = new Map(previous.map((row) => [row.id, row]))
      return rowsFromCache(all, PORTS.store).map((row) => ({
        ...row, ...known.get(row.id), index: row.index, provider: row.provider,
      }))
    })
    return all
  }, [note, notify])

  useEffect(() => {
    reloadAccounts().finally(() => { if (mounted.current) setAccountsReady(true) })
  }, [reloadAccounts])
  useEffect(() => () => clearTimeout(messageTimer.current), [])

  /**
   * Orca 가 지금 붙어 있는 계정을 따라간다.
   *
   * ~/.claude.json 은 Claude Code 가 로그인할 때 쓰는 파일이라 Orca 에서 계정을
   * 바꿔도 그대로다. 앱에 직접 물어야 손으로 바꾼 것이 화면에 뜬다.
   */
  useEffect(() => {
    let alive = true
    let pending = false
    const tick = async () => {
      if (pending) return
      pending = true
      try {
        const ids = await activeAccountIds()
        if (alive) setActiveIds(ids)
      } catch { /* Orca 가 꺼져 있으면 마지막으로 안 값을 그대로 둔다 */ } finally {
        pending = false
      }
    }
    tick()
    const handle = setInterval(tick, ACTIVE_POLL_MS)
    return () => {
      alive = false
      clearInterval(handle)
    }
  }, [])

  useEffect(() => {
    saveSettings({
      graphMode,
      rangeIndex,
      autoSwitch,
      keepAlive,
      tuning: tuned,
      hiddenIds,
      selectedId: selected >= 0
        ? (rows[selected]?.id ?? null)
        : `totals:${TOTAL_PROVIDER[selected] ?? 'claude'}`,
    })
  }, [graphMode, rangeIndex, autoSwitch, keepAlive, tuned, hiddenIds, selected, rows])

  // poll 안에서 읽으므로 ref 로 둔다. 상태를 의존성에 넣으면 껐다 켤 때마다
  // 폴링 타이머가 통째로 다시 걸린다.
  const allowSwitch = useRef(false)
  useEffect(() => { allowSwitch.current = autoSwitch }, [autoSwitch])

  /**
   * 활성 계정이 곧 막히면 여유로운 계정으로 갈아탄다.
   *
   * 이미 떠 있는 터미널은 옛 계정으로 계속 돈다. 바뀐 계정은 그다음에 여는
   * 세션부터 적용되므로, 지금 돌고 있는 작업이 끊기지는 않는다.
   */
  const maybeSwitch = useCallback(async (fresh) => {
    if (switching.current) return
    const claude = fresh.filter((row) => row.provider === 'claude')
    const verdict = decideSwitch(claude, advise(claude, loadHistory()), {
      activeId: activeIdsRef.current.claude,
      lastSwitchAt: lastSwitchAt.current,
    })
    // 안 옮길 때도 판단을 남긴다. 화면이 왜 가만히 있는지 설명해야 한다.
    setDecision(verdict)
    if (verdict.action !== 'switch') return

    switching.current = true
    try {
      await selectClaudeAccount(verdict.target.id)
      note('switch', `자동[${verdict.why}] ${verdict.reason}`, { email: verdict.target.email })
      lastSwitchAt.current = Date.now()
      saveSettings({ lastSwitchAt: lastSwitchAt.current })
      notify(`계정 전환: ${verdict.reason}`)
    } catch (error) {
      note('error', `자동 전환 실패: ${error.message}`, { email: verdict.target.email })
      notify(`전환 실패: ${error.message}`)
      setDecision({ action: 'hold', reason: `전환 실패: ${error.message}` })
    } finally {
      switching.current = false
    }
  }, [notify])

  const poll = useCallback(async ({ force = false, forceRefresh = false, only = null } = {}) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      // 계정이 늘거나 줄었는지 먼저 본다. 한 계정만 손보는 호출(t 키)에서는
      // 목록을 흔들 이유가 없으므로 건너뛴다.
      const list = (only ? null : await reloadAccounts()) ?? accounts
      const fresh = await pollOnce(list, {
        allowRefresh,
        force,
        forceRefresh,
        only,
        freshForMs: intervalMs * 0.9,
        onAccount: (row) => {
          setAllRows((previous) => previous.map((item) => (item.id === row.id ? row : item)))
        },
      }, PORTS)
      setAllRows((previous) => previous.map((item) => fresh.find((r) => r.id === item.id) ?? item))
      setHistory(loadHistory())
      const shape = fresh.map((row) => `${row.id}:${row.source}:${row.note ?? ''}`).join('|')
      if (shape !== lastShape.current) {
        lastShape.current = shape
        const viaOrca = fresh.filter((row) => row.source === 'orca').length
        note('poll', `${fresh.length} 계정, ${viaOrca === fresh.length ? 'Orca' : `Orca ${viaOrca}, 직접 ${fresh.length - viaOrca}`}`)
      }
      for (const row of fresh) {
        if (row.refreshedAt && row.refreshedAt > (refreshSeen.current.get(row.id) ?? 0)) {
          refreshSeen.current.set(row.id, row.refreshedAt)
          note('token', '갱신함', { email: row.email })
        }
        if (row.authFailed && !authSeen.current.has(row.id)) {
          authSeen.current.add(row.id)
          note('error', row.note ?? '자격증명 실패', { email: row.email })
        } else if (!row.authFailed) authSeen.current.delete(row.id)
      }
      if (keepAliveRef.current) {
        const now = Date.now()
        for (const row of fresh) {
          if (!needsOpening(row, now)) continue
          // 쿨다운은 기록에서 읽는다. ref 로만 들면 앱을 다시 띄울 때마다 초기화돼
          // 창이 이미 열렸는데도 요청을 또 보낸다.
          const lastAt = logRef.current.find((entry) => entry.kind === 'cycle' && entry.email === row.email)?.at ?? 0
          if (now - lastAt < tuning().openCooldownMs) continue
          const result = await openWindow(row.id)
          if (result.refreshed) note('token', '사이클 전에 갱신함', { email: row.email })
          note('cycle', result.ok ? '5h 창 열음' : `창 못 열음: ${result.reason}`,
            { email: row.email, ok: result.ok })
          notify(result.ok ? `${row.email} 5h 창 열음` : `${row.email} 창 못 열음: ${result.reason}`)
        }
      }
      if (allowSwitch.current) await maybeSwitch(fresh)
      else {
        const claude = fresh.filter((row) => row.provider === 'claude')
        setDecision(decideSwitch(claude, advise(claude, loadHistory()), {
          activeId: activeIdsRef.current.claude,
          lastSwitchAt: lastSwitchAt.current,
        }))
      }
    } catch (error) {
      note('error', `조회 실패: ${error.message}`)
      notify(`조회 실패: ${error.message}`)
    } finally {
      running.current = false
      setBusy(false)
      setNextPollAt(Date.now() + intervalMs)
    }
  }, [accounts, allowRefresh, intervalMs, notify, maybeSwitch, reloadAccounts])

  // 주기 조회. 첫 바퀴는 바로 돈다.
  useEffect(() => {
    if (!accountsReady) return undefined
    poll()
    timer.current = setInterval(() => poll(), intervalMs)
    return () => clearInterval(timer.current)
  }, [poll, intervalMs, accountsReady])

  // 카운트다운을 위해 1초마다 시각만 새로 잡는다.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  const doRefresh = useCallback(() => {
    clearInterval(timer.current)
    timer.current = setInterval(() => poll(), intervalMs)
    notify('전체 재조회')
    poll({ force: true })
  }, [notify, poll, intervalMs])

  /**
   * 고른 계정의 토큰을 다시 만든다.
   *
   * Orca 가 들고 있는 계정은 그쪽이 토큰을 돌린다. 둘이 같은 refresh token 을
   * 돌리면 rotation 에 한쪽이 revoke 되므로 평소에는 손대지 않는다. 다만 Orca
   * 는 지금 쓰는 계정만 돌려서 나머지는 만료된 채 남는다. 만료된 지 오래된
   * 것은 Orca 가 손을 놓은 것이라 우리가 집는다. 사이클 트리거가 쓰는 기준과
   * 같은 값을 쓴다. 둘이 어긋나면 화면에서 거부당한 계정을 백그라운드가 조용히
   * 갱신하게 된다.
   */
  const doToken = useCallback(() => {
    const row = rows[selected]
    if (!row) return notify('계정을 고른 뒤 눌러 주세요')
    if (!allowRefresh) return notify('갱신이 꺼져 있습니다')
    if (row.provider === 'codex') return notify('Codex 토큰은 Orca 만 다룹니다')
    if (row.source === 'orca') {
      const expiredFor = typeof row.expiresAt === 'number' ? Date.now() - row.expiresAt : null
      if (expiredFor == null || expiredFor < REFRESH_AFTER_EXPIRY_MS) {
        return notify('Orca 가 토큰을 관리 중입니다. 만료된 지 한 시간 넘은 계정만 손으로 갱신합니다')
      }
    }
    notify(`${row.email} 토큰 재생성`)
    poll({ force: true, forceRefresh: true, only: [row.id] })
  }, [rows, selected, allowRefresh, notify, poll])

  /** 지금 고른 계정으로 Orca 를 옮긴다. 자동 전환과 같은 경로를 쓴다. */
  const switchToSelected = useCallback(async () => {
    if (selected < 0) return notify('계정을 고른 뒤 눌러 주세요')
    const row = rows[selected]
    if (!row) return
    if (row.id === activeIds[row.provider]) return notify('이미 이 계정에 붙어 있습니다')
    if (switching.current) return

    switching.current = true
    try {
      if (row.provider === 'codex') await selectCodexAccount(row.id)
      else await selectClaudeAccount(row.id)
      // 다음 확인까지 기다리면 눌러 놓고 표시가 안 바뀐다.
      setActiveIds((previous) => ({ ...previous, [row.provider]: row.id }))
      // 수동 전환도 쿨다운에 넣는다. 안 그러면 자동 전환이 곧바로 되돌린다.
      lastSwitchAt.current = Date.now()
      saveSettings({ lastSwitchAt: lastSwitchAt.current })
      note('switch', '수동 전환', { email: row.email })
      notify(`${row.email} 로 전환`)
      poll({ force: true })
    } catch (error) {
      note('error', `수동 전환 실패: ${error.message}`, { email: row.email })
      notify(`전환 실패: ${error.message}`)
    } finally {
      switching.current = false
    }
  }, [rows, selected, activeIds, notify, poll])

  /** 값을 한 칸 옮긴다. 범위 밖은 applyTuning 이 잘라 준다. */
  const nudgeKey = useCallback((key, direction) => {
    const item = TUNABLES.find((entry) => entry.key === key)
    if (!item) return
    const next = direction === 0
      ? TUNING_DEFAULTS[item.key]
      : tuning()[item.key] + item.step * direction
    setTuned({ ...applyTuning({ [item.key]: next }) })
  }, [])
  const nudge = useCallback((direction) => {
    nudgeKey(TUNABLES[tuneAt]?.key, direction)
  }, [nudgeKey, tuneAt])
  // 판정 화면의 지표 넷은 가중치 항목과 순서가 같다.
  const WEIGHT_KEYS = ['weightBehind', 'weightNow', 'weightReserve']
  const nudgeWeight = useCallback((direction) => {
    nudgeKey(WEIGHT_KEYS[scoreAt], direction)
  }, [nudgeKey, scoreAt])

  /** 탭을 한 칸 옮긴다. 끝에서는 반대편으로 돈다. */
  const stepTab = useCallback((direction) => {
    setGraphMode((value) => {
      const at = GRAPH_TABS.findIndex((tab) => tab.mode === value)
      return GRAPH_TABS[(at + direction + GRAPH_TABS.length) % GRAPH_TABS.length].mode
    })
  }, [])

  /**
   * 고른 계정을 숨기거나 되돌린다.
   *
   * 지금 붙어 있는 계정도 숨는다. 한 provider 의 계정을 하나만 쓰는 동안 나머지
   * 목록이 자리만 먹는 일이 있고, 그때 붙어 있는 것이 어느 것인지는 이미 알고
   * 있다. 숨긴 계정은 X 로 언제든 꺼내 본다.
   */
  const toggleHidden = useCallback(() => {
    const row = rows[selected]
    if (!row) return notify('계정을 고른 뒤 눌러 주세요')
    setHiddenIds((ids) => {
      const next = ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id]
      notify(next.includes(row.id) ? `${row.email} 숨김` : `${row.email} 다시 보임`)
      return next
    })
  }, [rows, selected, notify])

  const runAction = useCallback((key) => {
    if (key === 'r') doRefresh()
    else if (key === 't') doToken()
    else if (key === 'x') toggleHidden()
    else if (key === 'X') setShowHidden((value) => !value)
    else if (key === 'o') {
      setKeepAlive((value) => {
        notify(value
          ? '창 미리 열기 끔. 안 쓰는 계정의 리셋 시계가 멈춥니다'
          : '창 미리 열기 켬. 닫힌 5h 와 7d 창을 요청 하나로 엽니다')
        return !value
      })
    }
    else if (key === 'a') {
      setAutoSwitch((value) => {
        notify(value
          ? '자동 전환 끔. 계정은 Enter 로 손수 옮깁니다'
          : `자동 전환 켬. 활성이 ${tuning().switchAt}% 를 넘고 다른 곳이 ${tuning().switchMargin}%p 여유로우면 옮깁니다`)
        return !value
      })
    }
    else if (key === 'w') {
      setRangeIndex((value) => {
        const next = (value + 1) % RANGES.length
        notify(`기간: ${RANGES[next].label}`)
        return next
      })
    }
    else if (key === 'q') exit()
  }, [doRefresh, doToken, exit, notify, toggleHidden])

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
    const tunes = graphMode === 'settings' || graphMode === 'score'
    const tuning = tunes && editing
    // 기록과 도움말은 한 화면에 다 안 들어간다. 위아래가 목록 대신 이쪽을 굴린다.
    const logRows = logVisibleRows(layout.graphHeight - 1)
    const maxLog = Math.max(0, logEntries.length - logRows)
    const helpBody = helpVisibleRows(layout.graphHeight - 1)
    const maxHelp = Math.max(0, helpRows(graphWidth).length - helpBody)

    if (key.escape || (key.ctrl && input === 'c')) {
      // 고치던 중이면 그것부터 닫는다. 종료를 되묻는 것은 그다음이다.
      if (key.escape && tuning) return setEditing(false)
      const at = Date.now()
      if (at - quitAt.current < QUIT_WINDOW_MS) return exit()
      quitAt.current = at
      return notify('한 번 더 누르면 종료합니다. q 는 바로 끝냅니다')
    }

    /** 값을 고치는 화면이면 수정모드를 여닫고, 아니면 고른 계정으로 옮긴다. */
    const enter = () => {
      if (!tunes) return switchToSelected()
      setEditing((value) => {
        if (!value) notify('수정 중입니다. 좌우로 값을 바꾸고 Enter 나 Esc 로 끝냅니다')
        return !value
      })
    }
    /** 값을 한 칸 옮긴다. 어느 화면인지에 따라 대상이 갈린다. */
    const nudgeHere = (direction) => (
      graphMode === 'settings' ? nudge(direction) : nudgeWeight(direction))
    /** 위아래가 무엇을 옮기는지는 지금 보고 있는 패널이 정한다. */
    const step = (direction) => {
      if (graphMode === 'settings') {
        return setTuneAt((at) => Math.min(TUNABLES.length - 1, Math.max(0, at + direction)))
      }
      if (graphMode === 'score') {
        return setScoreAt((at) => Math.min(WEIGHT_KEYS.length - 1, Math.max(0, at + direction)))
      }
      if (graphMode === 'log') {
        return setLogAt((at) => Math.min(maxLog, Math.max(0, at + direction)))
      }
      if (graphMode === 'help') {
        return setHelpAt((at) => Math.min(maxHelp, Math.max(0, at + direction)))
      }
      return moveSelection(direction)
    }

    if (key.return) return enter()
    if (key.leftArrow) return tuning ? nudgeHere(-1) : stepTab(-1)
    if (key.rightArrow) return tuning ? nudgeHere(1) : stepTab(1)
    // 기록은 500건까지 쌓인다. 한 줄씩으로는 지난주에 닿지 못한다.
    const page = graphMode === 'log' ? logRows : graphMode === 'help' ? helpBody : 1
    if (key.pageDown) return step(page)
    if (key.pageUp) return step(-page)
    if (key.downArrow) return step(1)
    if (key.upArrow) return step(-1)
    // 빠른 연타나 붙여넣기는 여러 글자가 한 번에 들어온다. 글자마다 처리해야
    // 'fg' 같은 입력이 통째로 버려지지 않는다.
    for (const char of input) {
      // 빠른 연타나 붙여넣기로 여러 글자가 한 입력에 실려 오면 ink 가 특수키
      // 판정을 하지 않는다. 개행도 여기서 직접 받아야 엔터가 묻히지 않는다.
      if (char === '\r' || char === '\n') enter()
      else if (tuning && 'hl0'.includes(char)) {
        if (char === 'h') nudgeHere(-1)
        else if (char === 'l') nudgeHere(1)
        else nudgeHere(0)
      }
      else if (char === 'j') step(1)
      else if (char === 'k') step(-1)
      else if (char === '0') setSelected(stops[0] ?? TOTAL_AT.claude)
      else if (char >= '1' && char <= '9') {
        // 화면에 적힌 번호로 찾는다. 배열 위치로 세면 숨긴 계정이 있을 때
        // 눌린 숫자와 골라지는 계정이 어긋난다.
        const at = rows.findIndex((row) => row.index === Number(char))
        if (at >= 0) setSelected(at)
      } else if ('rtqwaoxX'.includes(char)) runAction(char)
    }
  })

  // 화면을 위에서부터 쌓아 클릭 좌표를 행으로 되짚는다. 액션 바는 항상 맨 아래다.
  const layout = useMemo(() => {
    // 상자 높이는 화면에 맞춘다. 내용만큼 커지게 두면 계정이 많을 때 상자가
    // 화면을 넘어 아래 테두리가 잘린 채로 남는다.
    const panelHeight = Math.max(6, screenRows - HEADER_ROWS - 1)
    return {
      panelWidth,
      panelHeight,
      // 그래프는 그 상자에서 테두리 두 줄을 뺀 만큼이다. 따로 재면 상자를 넘는다.
      graphHeight: Math.max(4, panelHeight - 2),
    }
  }, [panelWidth, screenRows])

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
    const rowsIn = (start, end) => {
      let sum = 0
      for (let index = start; index < end; index += 1) {
        sum += blocks[index] + (index === start || isHead(index) ? headRows(index) : 0)
      }
      return sum
    }
    const budget = layout.panelHeight - 2
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
  }, [rows, selected, totalRowsFor, adviceCompact, layout.panelHeight])

  const onClick = useCallback((row, column) => {
    // 마우스는 1 부터 세고 배치 좌표는 0 부터 센다.
    const y = row - 1 - columnTop.current
    // ink 의 overflow 는 그리기만 자르고 배치는 그대로라, 상자 밖으로 밀린 블록도
    // 좌표를 갖는다. 아래 테두리와 액션 바를 눌러 안 보이는 계정이 잡히면 안 된다.
    if (y >= layout.panelHeight - 1) return
    if (column > layout.panelWidth) {
      // 오른쪽 상자의 탭 줄. 자리는 재 둔 것을 쓴다. 테두리와 패딩을 세어 맞추면
      // 상자 모양이 바뀔 때마다 어긋난다.
      const tabs = hits.current.get(TAB_HIT)
      if (!tabs || y < tabs.top || y >= tabs.top + tabs.height) return
      const at = column - 1 - (listVisible ? layout.panelWidth + 2 : 2)
      const tab = TAB_RANGES.find((range) => at >= range.start && at < range.end)
      if (tab) setGraphMode(tab.mode)
      return
    }
    for (const [id, box] of hits.current) {
      if (id === TAB_HIT) continue
      if (y >= box.top && y < box.top + box.height) {
        setSelected(() => id)
        return
      }
    }
  }, [layout.panelWidth, layout.panelHeight, listVisible])

  useMouseReporting()

  // 추천 요약과 자동 전환이 같은 판단을 쓴다. 한 번만 계산한다.
  const tip = useMemo(() => advise(claudeRows, history, now), [claudeRows, history, now])
  // 판정 화면이 쓰는 지표. advise 와 같은 계산이라 화면과 판단이 어긋나지 않는다.
  const scored = useMemo(
    () => scoreAccounts(claudeRows, history, now).filter((entry) => entry.hasData),
    [claudeRows, history, now])
  const current = selected >= 0 ? rows[selected] : null
  // 합계 줄을 고르고 있을 때 그릴 전체 그래프. 고른 줄의 provider 를 따른다.
  const overviewProvider = TOTAL_PROVIDER[selected] ?? 'claude'
  if (rows.length === 0) return <Text color="red">{'Orca 계정을 찾지 못했습니다.'}</Text>

  return (
    <Box flexDirection="column" height={screenRows} width={columns}>
      <Header
        nextPollAt={nextPollAt}
        busy={busy}
        now={now}
        message={message}
        autoSwitch={autoSwitch}
        direct={rows.some((row) => row.source === 'direct')}
      />
      <HitRoot onMeasure={onColumnTop} flexGrow={1} flexDirection="row">
        {/* 왼쪽은 flexShrink 를 막는다. 오른쪽 내용이 길면 flex 가 이쪽을 눌러
            막대와 이름이 잘리는데, 폭은 목록이 필요로 하는 만큼이라 내줄 자리가
            없다. */}
        {listVisible ? (
        <Box
          width={layout.panelWidth}
          height={layout.panelHeight}
          flexShrink={0}
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          overflow="hidden"
        >
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
                      width={layout.panelWidth - 4}
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
              />
            </Hit>
            </React.Fragment>
            )
          })}
          <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
            <Advice tip={tip} compact={adviceCompact} />
            <AutoBlock
              rows={claudeRows}
              keepAlive={keepAlive}
              autoSwitch={autoSwitch}
              failures={recentFailures}
              now={now}
            />
          </Box>
        </Box>
        ) : null}

        {graphVisible ? (
        <Box
          flexGrow={1}
          height={layout.panelHeight}
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          overflow="hidden"
        >
          <Hit id={TAB_HIT} onMeasure={onHit}>
            <GraphTabs mode={graphMode} width={graphWidth} />
          </Hit>
          {graphMode === 'score'
            ? (
              <Score
                scored={scored}
                activeId={activeIds.claude}
                useId={tip?.use?.row.id}
                decision={decision}
                selected={scoreAt}
                editing={editing}
                height={layout.graphHeight - 1}
                columns={graphWidth}
              />
              )
            : graphMode === 'settings'
            ? (
              <Settings
                values={tuned}
                selected={tuneAt}
                editing={editing}
                height={layout.graphHeight - 1}
                columns={graphWidth}
              />
              )
            : graphMode === 'help'
            ? <Help offset={helpAt} height={layout.graphHeight - 1} columns={graphWidth} />
            : graphMode === 'log'
            ? (
              <Log
                entries={logEntries}
                now={now}
                offset={logAt}
                height={layout.graphHeight - 1}
                columns={graphWidth}
              />
              )
            : graphMode === 'schedule'
            ? (
              <Schedule
                rows={claudeRows}
                historyById={history}
                now={now}
                height={layout.graphHeight - 1}
                columns={graphWidth}
              />
              )
            : (current
                ? (
                  <Graph
                    row={current}
                    history={history[current.id] ?? []}
                    columns={graphWidth}
                    height={layout.graphHeight - 1}
                    mode={graphMode}
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
                    height={layout.graphHeight - 1}
                    mode={graphMode}
                        rangeMs={RANGES[rangeIndex].ms}
                    rangeLabel={RANGES[rangeIndex].label}
                    style={graphStyle}
                  />
                  ))}
        </Box>
        ) : null}
      </HitRoot>
      <ActionBar />
    </Box>
  )
}
