import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { collectAccounts, collectAllAccounts } from '../accounts.js'
import { advise } from '../advice.js'
import { SWITCH_AT, decideSwitch } from '../autoswitch.js'
import { RANGES } from '../chart.js'
import { activeAccountIds, selectClaudeAccount } from '../orca-rpc.js'
import { selectCodexAccount } from '../orca-limits.js'
import { loadSettings, saveSettings } from '../settings.js'
import { shortSpan, visibleWindows } from '../format.js'
import { useFullscreen } from '../fullscreen.js'
import { isMouseSequence, parseMouseClick, useMouseReporting } from '../mouse.js'
import { pollOnce, rowsFromCache } from '../poller.js'
import { loadHistory } from '../store.js'
import { ACTIVE_MARK, AccountBlock, BADGES, blockHeight } from './AccountBlock.jsx'
import { TotalBars, totalBarsHeight } from './TotalBars.jsx'
import { Advice, AutoBlock, Graph, OverviewGraph, adviceHeight, autoBlockHeight } from './Graph.jsx'
import { Hit, HitRoot } from './Hit.jsx'
import { Schedule } from './Schedule.jsx'
import { OPEN_COOLDOWN_MS, needsOpening, openWindow } from '../keepalive.js'

const HEADER_ROWS = 2
// 활성 계정만 따로 확인하는 주기. 사용량 조회와 달리 소켓 한 번이라 가볍고,
// Orca 에서 손으로 바꾼 것이 화면에 늦게 뜨면 어느 계정으로 도는지 헷갈린다.
const ACTIVE_POLL_MS = 5000
// 섹션 머리글. 계정 수와 창 구조가 provider 마다 달라 목록을 갈라 세운다.
const PROVIDER_LABEL = { claude: 'Claude', codex: 'Codex' }
// 그래프 상자 안쪽이 이보다 좁으면 그래프를 접고 목록이 폭을 다 쓴다. 눈금
// 여섯 칸을 빼고 서른 칸은 있어야 선이 형태를 갖춘다. 화면 폭이 아니라 목록이
// 쓰고 남는 칸으로 재는 이유는, 목록 폭이 긴 이메일을 따라 늘기 때문이다.
const MIN_GRAPH_WIDTH = 36
// 범례부터 접는다. 범례는 고정 문구라 추천의 한 줄보다 덜 급하다.
const MIN_LEGEND_ROWS = 34
// 이보다 낮으면 모델별 창을 접고 추천도 첫 줄만 남긴다. 계정마다 한 줄씩 벌어
// 계정 수가 더 들어간다.
const TIGHT_ROWS = 30
// 빈 줄 하나와 범례 한 줄.
const LEGEND_ROWS = 2
// 라벨을 짧게 둔다. 아래 한 줄에 범례까지 같이 실려서 길면 통째로 밀린다.
const ACTIONS = [
  { key: 'r', label: '조회' },
  { key: 't', label: '토큰' },
  { key: 'd', label: '모드' },
  { key: 'f', label: 'Fable' },
  { key: 'w', label: '기간' },
  { key: 'a', label: '자동' },
  { key: 'o', label: '사이클' },
  { key: 'enter', label: '전환' },
  { key: 'g', label: '그래프' },
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

// 어떤 표시가 있고 무슨 색인지만 알린다. 글자가 곧 뜻이라 부연을 붙이면 한 줄을
// 넘겨 통째로 잘린다. 자세한 설명은 --help 에 있다.
const BADGE_LEGEND = [
  { text: `${ACTIVE_MARK} 활성`, color: 'yellow' },
  BADGES.use,
  BADGES.spurt,
  BADGES.spare,
  BADGES.blocked,
]

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

function BadgeLegend() {
  return (
    <Text wrap="truncate">
      {BADGE_LEGEND.map((badge, index) => (
        <Text key={badge.text} color={badge.color} bold>
          {index ? `  ${badge.text}` : badge.text}
        </Text>
      ))}
    </Text>
  )
}

export function App({ intervalMs, allowRefresh }) {
  const { exit } = useApp()
  const { columns, rows: screenRows } = useFullscreen()

  const saved = useMemo(() => loadSettings(), [])
  // Claude 는 디렉터리를 읽으면 끝이라 첫 프레임에 바로 세운다. Codex 는 Orca 에
  // 물어야 해서 곧이어 합류한다. 기다렸다 함께 그리면 첫 화면이 그만큼 늦다.
  const [accounts, setAccounts] = useState(() => collectAccounts())
  const [accountsReady, setAccountsReady] = useState(false)
  const [rows, setRows] = useState(() => rowsFromCache(accounts))
  // 어느 계정에 붙어 있는지는 Orca 만 안다. 행마다 박아 두면 일부만 갱신했을 때
  // 옛 표시가 남아 별표가 둘이 된다. 한 곳에 두고 화면이 그때그때 비교한다.
  const [activeIds, setActiveIds] = useState(
    () => ({ claude: accounts.find((account) => account.active)?.id ?? null, codex: null }))
  // poll 안에서 읽으므로 ref 로도 들고 있는다. 의존성에 넣으면 계정이 바뀔 때마다
  // 폴링 타이머가 통째로 다시 걸린다.
  const activeIdsRef = useRef(activeIds)
  useEffect(() => { activeIdsRef.current = activeIds }, [activeIds])

  useEffect(() => {
    let alive = true
    collectAllAccounts()
      .then((all) => {
        if (!alive) return
        setAccounts(all)
        // 그 사이 폴링이 채운 값을 지우지 않는다. 새로 합류한 계정만 캐시에서 온다.
        setRows((previous) => {
          const known = new Map(previous.map((row) => [row.id, row]))
          return rowsFromCache(all).map((row) => ({
            ...row, ...known.get(row.id), index: row.index, provider: row.provider,
          }))
        })
      })
      .catch(() => { /* Orca 가 꺼져 있으면 Claude 만 보여 준다 */ })
      .finally(() => { if (alive) setAccountsReady(true) })
    return () => { alive = false }
  }, [])
  const [history, setHistory] = useState(() => loadHistory())
  // 저장된 선택은 초기값에서 바로 정한다. effect 로 나중에 덮으면 그 사이에
  // 들어온 클릭이 되감긴다. 계정 id 로 찾으므로 목록이 바뀌어도 안전하다.
  const [selected, setSelected] = useState(() => {
    if (!saved.selectedId) return -1
    const index = accounts.findIndex((account) => account.id === saved.selectedId)
    return index >= 0 ? index : -1
  })
  const [busy, setBusy] = useState(false)
  const [showGraph, setShowGraph] = useState(saved.showGraph)
  const [graphMode, setGraphMode] = useState(saved.graphMode)
  const [rangeIndex, setRangeIndex] = useState(saved.rangeIndex)
  // 기본은 꺼 둔다. 계정을 바꾸는 일이라 켜는 것은 사람이 정한다.
  const [autoSwitch, setAutoSwitch] = useState(saved.autoSwitch)
  // 창 유지. 안 쓰는 계정의 5h 창을 열어 두어 리셋 시계가 돌게 한다.
  const [keepAlive, setKeepAlive] = useState(saved.keepAlive)
  const keepAliveRef = useRef(false)
  useEffect(() => { keepAliveRef.current = keepAlive }, [keepAlive])
  // 계정별로 마지막에 창을 연 시각. 한 바퀴 안에 두 번 보내지 않는다.
  const openedAt = useRef(new Map())
  // 마지막으로 창을 연 결과. 자동 블록이 보인다.
  const [lastOpen, setLastOpen] = useState(null)
  const lastSwitchAt = useRef(saved.lastSwitchAt)
  const switching = useRef(false)
  const [decision, setDecision] = useState(null)
  const [showModelWindows, setShowModelWindows] = useState(saved.showModelWindows)
  const [message, setMessage] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [nextPollAt, setNextPollAt] = useState(Date.now() + intervalMs)

  // 왼쪽 폭은 내용이 정한다. 비율로 잡으면 좁은 터미널에서 이름이 잘리고 넓은
  // 터미널에서는 빈 자리가 남는다. 오른쪽 그래프가 나머지를 다 쓴다.
  // 막대 줄은 들여쓰기 5, 창 이름 7, 막대, 퍼센트 5, 남은 시간 9 와 상자의 테두리
  // 둘에 패딩 둘로 이뤄진다. 폭이 모자라면 막대부터 줄여야 줄이 안 접힌다.
  const barWidth = Math.max(8, Math.min(26, columns - 30))
  // 추천과 전체 합계는 Claude 안에서만 선다. Codex 는 창이 7d 하나뿐이라
  // 같은 자로 재면 5h 가 빈 것처럼 읽힌다.
  const claudeRows = useMemo(() => rows.filter((row) => row.provider === 'claude'), [rows])

  // 목록이 그래프와 나란히 설 때 필요한 폭. 내용이 정한다.
  const listWidth = useMemo(() => {
    const labelOf = (row) => (row.label ? row.label.length + 4 : 0)
    // 머리글: 들여쓰기와 번호, 별표 자리, 이름, 요금제, 배지
    const header = 5 + 2 + Math.max(0, ...rows.map((row) => row.email.length))
      + Math.max(0, ...rows.map(labelOf)) + 11
    // 막대 줄: 들여쓰기, 창 이름, 막대, 퍼센트, 남은 시간
    const bar = 5 + 7 + barWidth + 5 + 9
    // 좌우 패딩 둘과 테두리 둘
    return Math.min(columns - 24, Math.max(header, bar) + 4)
  }, [rows, columns, barWidth])

  // 설정은 건드리지 않는다. 창을 넓히면 접었던 것이 그대로 돌아와야 한다.
  // 그래프 상자의 테두리와 패딩 넷을 뺀 나머지가 그래프에 돌아간다.
  const graphFits = columns - listWidth - 4 >= MIN_GRAPH_WIDTH
  const windowsFit = screenRows >= TIGHT_ROWS
  const graphVisible = showGraph && graphFits
  const windowsVisible = showModelWindows && windowsFit
  const legendVisible = screenRows >= MIN_LEGEND_ROWS
  const adviceCompact = screenRows < TIGHT_ROWS
  const panelWidth = graphVisible ? listWidth : columns
  // 키 처리기가 읽는다. 의존성에 넣으면 창 크기가 바뀔 때마다 처리기가 다시 만들어진다.
  const fit = useRef({ graph: true, windows: true })
  fit.current = { graph: graphFits, windows: windowsFit }

  const running = useRef(false)
  const timer = useRef(null)

  const messageTimer = useRef(null)
  const notify = useCallback((text) => {
    setMessage(text)
    // 상시로 띄워 두는 화면이라 눈이 늘 여기 있지 않다. 짧으면 놓친다.
    // 타이머는 하나만 둔다. 겹치면 앞 것이 새 메시지를 먼저 지우고, 종료 뒤에도
    // 남은 타이머가 프로세스를 8초까지 붙들었다.
    clearTimeout(messageTimer.current)
    messageTimer.current = setTimeout(() => setMessage(null), 8000)
  }, [])
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
      showModelWindows,
      showGraph,
      autoSwitch,
      keepAlive,
      selectedId: selected >= 0 ? (rows[selected]?.id ?? null) : null,
    })
  }, [graphMode, rangeIndex, showModelWindows, showGraph, autoSwitch, keepAlive, selected, rows])

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
      lastSwitchAt.current = Date.now()
      saveSettings({ lastSwitchAt: lastSwitchAt.current })
      notify(`계정 전환: ${verdict.reason}`)
    } catch (error) {
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
      const fresh = await pollOnce(accounts, {
        allowRefresh,
        force,
        forceRefresh,
        only,
        freshForMs: intervalMs * 0.9,
        onAccount: (row) => {
          setRows((previous) => previous.map((item) => (item.id === row.id ? row : item)))
        },
      })
      setRows((previous) => previous.map((item) => fresh.find((r) => r.id === item.id) ?? item))
      setHistory(loadHistory())
      if (keepAliveRef.current) {
        const now = Date.now()
        for (const row of fresh) {
          if (!needsOpening(row, now)) continue
          if (now - (openedAt.current.get(row.id) ?? 0) < OPEN_COOLDOWN_MS) continue
          openedAt.current.set(row.id, now)
          const result = await openWindow(row.id)
          setLastOpen({ email: row.email, at: now, ...result })
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
      notify(`조회 실패: ${error.message}`)
    } finally {
      running.current = false
      setBusy(false)
      setNextPollAt(Date.now() + intervalMs)
    }
  }, [accounts, allowRefresh, intervalMs, notify, maybeSwitch])

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

  const doToken = useCallback(() => {
    const row = rows[selected]
    if (!row) return notify('계정을 고른 뒤 눌러 주세요')
    if (!allowRefresh) return notify('갱신이 꺼져 있습니다')
    if (rows.some((item) => item.source === 'orca')) {
      return notify('Orca 가 토큰을 관리 중입니다. 재로그인은 Orca 에서 합니다')
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
      notify(`${row.email} 로 전환`)
      poll({ force: true })
    } catch (error) {
      notify(`전환 실패: ${error.message}`)
    } finally {
      switching.current = false
    }
  }, [rows, selected, activeIds, notify, poll])

  const runAction = useCallback((key) => {
    if (key === 'r') doRefresh()
    else if (key === 't') doToken()
    else if (key === 'g') {
      // 화면이 좁아 접힌 상태에서 설정만 뒤집히면, 다음에 넓은 창에서 그래프가
      // 말없이 사라진다.
      if (!fit.current.graph) notify('화면이 좁아 그래프를 접었습니다')
      else setShowGraph((value) => !value)
    }
    else if (key === 'o') {
      setKeepAlive((value) => {
        notify(value ? '사이클 자동트리거 끔' : '사이클 자동트리거 켬 (닫힌 5h 창을 요청 하나로 엽니다)')
        return !value
      })
    }
    else if (key === 'a') {
      setAutoSwitch((value) => {
        notify(value ? '자동 전환 끔' : `자동 전환 켬 (활성이 ${SWITCH_AT}% 넘으면 갈아탐)`)
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
    else if (key === 'f') {
      if (!fit.current.windows) notify('화면이 낮아 모델별 창을 접었습니다')
      else {
        setShowModelWindows((value) => {
          notify(value ? 'Fable 숨김' : 'Fable 표시')
          return !value
        })
      }
    }
    else if (key === 'd') {
      setGraphMode((value) => {
        // 사용량, 소비, 일정 순으로 돈다. 일정은 계정을 골라도 전체를 본다.
        const next = value === 'level' ? 'rate' : value === 'rate' ? 'schedule' : 'level'
        notify({ rate: '그래프: 시간당 소비', schedule: '그래프: 일주일 일정', level: '그래프: 사용량' }[next])
        return next
      })
    }
    else if (key === 'q') exit()
  }, [doRefresh, doToken, exit, notify])

  useInput((input, key) => {
    // 마우스 리포팅을 켜 두면 클릭 좌표가 `[<0;100;12M` 같은 문자열로 여기
    // 들어온다. 글자별로 훑으면 좌표의 숫자가 계정 선택으로 읽혀, 그래프 아무
    // 데나 눌러도 계정이 바뀐다. 클릭으로 처리하고 아래로 넘기지 않는다.
    if (isMouseSequence(input)) {
      const click = parseMouseClick(input)
      if (click) onClick(click.row, click.column)
      return
    }
    if (key.escape || (key.ctrl && input === 'c')) return exit()
    if (key.return) return switchToSelected()
    if (key.downArrow) return setSelected((i) => Math.min(rows.length - 1, i + 1))
    if (key.upArrow) return setSelected((i) => Math.max(-1, i - 1))
    // 빠른 연타나 붙여넣기는 여러 글자가 한 번에 들어온다. 글자마다 처리해야
    // 'fd' 같은 입력이 통째로 버려지지 않는다.
    for (const char of input) {
      // 빠른 연타나 붙여넣기로 여러 글자가 한 입력에 실려 오면 ink 가 특수키
      // 판정을 하지 않는다. 개행도 여기서 직접 받아야 엔터가 묻히지 않는다.
      if (char === '\r' || char === '\n') switchToSelected()
      else if (char === 'j') setSelected((i) => Math.min(rows.length - 1, i + 1))
      else if (char === 'k') setSelected((i) => Math.max(-1, i - 1))
      else if (char === '0') setSelected(-1)
      else if (char >= '1' && char <= '9') {
        const index = Number(char) - 1
        if (index < rows.length) setSelected(index)
      } else if ('rtdfgqwao'.includes(char)) runAction(char)
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
    const blocks = rows.map((row) => blockHeight(row, windowsVisible))
    const isHead = (index) => index === 0 || rows[index].provider !== rows[index - 1].provider
    // 구간이 차지하는 줄 수. 첫 행에는 늘 머리글이 붙고 안쪽은 provider 가 바뀔
    // 때 붙는다. 렌더가 그리는 규칙과 같아야 한다.
    const rowsIn = (start, end) => {
      let sum = 0
      for (let index = start; index < end; index += 1) {
        sum += blocks[index] + (index === start || isHead(index) ? 1 : 0)
      }
      return sum
    }
    const budget = layout.panelHeight - 2
      - totalBarsHeight(claudeRows, windowsVisible)
      - adviceHeight(adviceCompact) - autoBlockHeight(adviceCompact)
      - (legendVisible ? LEGEND_ROWS : 0)
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
  }, [rows, selected, claudeRows, windowsVisible, legendVisible, adviceCompact, layout.panelHeight])

  const onClick = useCallback((row, column) => {
    if (column > layout.panelWidth) return
    // 마우스는 1 부터 세고 배치 좌표는 0 부터 센다.
    const y = row - 1 - columnTop.current
    // ink 의 overflow 는 그리기만 자르고 배치는 그대로라, 상자 밖으로 밀린 블록도
    // 좌표를 갖는다. 아래 테두리와 액션 바를 눌러 안 보이는 계정이 잡히면 안 된다.
    if (y >= layout.panelHeight - 1) return
    for (const [id, box] of hits.current) {
      if (y >= box.top && y < box.top + box.height) {
        setSelected(() => id)
        return
      }
    }
  }, [layout.panelWidth, layout.panelHeight])

  useMouseReporting()

  // 추천은 계정 목록의 배지와 아래 요약이 함께 쓴다. 한 번만 계산한다.
  const tip = useMemo(() => advise(claudeRows, history, now), [claudeRows, history, now])
  const current = selected >= 0 ? rows[selected] : null
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
        <Box
          width={layout.panelWidth}
          height={layout.panelHeight}
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          overflow="hidden"
        >
          <Hit id={-1} onMeasure={onHit}>
            <TotalBars
            rows={claudeRows}
            width={layout.panelWidth - 4}
            now={now}
            showModelWindows={windowsVisible}
              selected={selected === -1}
            />
          </Hit>
          {rows.slice(view.start, view.end).map((row, offset) => {
            const index = view.start + offset
            return (
            <React.Fragment key={row.id}>
              {index === view.start || row.provider !== rows[index - 1]?.provider
                ? (
                  <Box flexShrink={0}>
                    <Text color="gray">{PROVIDER_LABEL[row.provider] ?? row.provider}</Text>
                  </Box>
                  )
                : null}
            <Hit id={index} onMeasure={onHit}>
              <AccountBlock
                row={row}
                active={row.id === activeIds[row.provider]}
                selected={index === selected}
                now={now}
                barWidth={barWidth}
                showModelWindows={windowsVisible}
                staleAfterMs={intervalMs * 4}
                badge={tip?.badges?.[row.id]}
              />
            </Hit>
            </React.Fragment>
            )
          })}
          <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
            <Advice tip={tip} compact={adviceCompact} />
            <AutoBlock
              rows={claudeRows}
              lastOpen={lastOpen}
              keepAlive={keepAlive}
              autoSwitch={autoSwitch}
              decision={decision}
              now={now}
              compact={adviceCompact}
            />
            {legendVisible
              ? <><Text> </Text><BadgeLegend /></>
              : null}
          </Box>
        </Box>

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
          {graphMode === 'schedule'
            ? (
              <Schedule
                rows={claudeRows}
                historyById={history}
                now={now}
                height={layout.graphHeight}
                columns={columns - layout.panelWidth - 4}
              />
              )
            : (current
                ? (
                  <Graph
                    row={current}
                    history={history[current.id] ?? []}
                    columns={columns - layout.panelWidth - 4}
                    height={layout.graphHeight}
                    mode={graphMode}
                    showModelWindows={windowsVisible}
                    rangeMs={RANGES[rangeIndex].ms}
                    rangeLabel={RANGES[rangeIndex].label}
                  />
                  )
                : (
                  <OverviewGraph
                    accounts={claudeRows}
                    historyById={history}
                    columns={columns - layout.panelWidth - 4}
                    height={layout.graphHeight}
                    mode={graphMode}
                    showModelWindows={windowsVisible}
                    rangeMs={RANGES[rangeIndex].ms}
                    rangeLabel={RANGES[rangeIndex].label}
                  />
                  ))}
        </Box>
        ) : null}
      </HitRoot>
      <ActionBar />
    </Box>
  )
}
