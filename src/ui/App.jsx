import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import { collectAccounts } from '../accounts.js'
import { advise } from '../advice.js'
import { SWITCH_AT, decideSwitch } from '../autoswitch.js'
import { RANGES } from '../chart.js'
import { activeAccountId, selectClaudeAccount } from '../orca-rpc.js'
import { loadSettings, saveSettings } from '../settings.js'
import { shortSpan } from '../format.js'
import { useFullscreen } from '../fullscreen.js'
import { isMouseSequence, parseMouseClick, useMouseReporting } from '../mouse.js'
import { pollOnce, rowsFromCache } from '../poller.js'
import { loadHistory } from '../store.js'
import { ACTIVE_MARK, AccountBlock, BADGES, blockHeight } from './AccountBlock.jsx'
import { TotalBars } from './TotalBars.jsx'
import { Advice, Graph, OverviewGraph } from './Graph.jsx'
import { Hit, HitRoot } from './Hit.jsx'

const HEADER_ROWS = 2
// 활성 계정만 따로 확인하는 주기. 사용량 조회와 달리 소켓 한 번이라 가볍고,
// Orca 에서 손으로 바꾼 것이 화면에 늦게 뜨면 어느 계정으로 도는지 헷갈린다.
const ACTIVE_POLL_MS = 5000
// 라벨을 짧게 둔다. 아래 한 줄에 범례까지 같이 실려서 길면 통째로 밀린다.
const ACTIONS = [
  { key: 'r', label: '조회' },
  { key: 't', label: '토큰' },
  { key: 'd', label: '모드' },
  { key: 'f', label: 'Fable' },
  { key: 'w', label: '기간' },
  { key: 'a', label: '자동' },
  { key: 'enter', label: '전환' },
  { key: 'g', label: '그래프' },
  { key: 'q', label: '종료' },
]

function Header({ nextPollAt, busy, now, message, autoSwitch, selected }) {
  const right = busy
    ? '조회 중'
    : nextPollAt ? `다음 조회 ${shortSpan(nextPollAt - now)}` : ''
  return (
    <>
      <Box justifyContent="space-between" paddingX={1}>
        <Text>
          <Text color="white" bold>{'watching all accounts'}</Text>
          {message ? <Text color="yellow">{`   ${message}`}</Text> : null}
        </Text>
        <Text>
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
  const accounts = useMemo(() => collectAccounts(), [])
  const [rows, setRows] = useState(() => rowsFromCache(accounts))
  // 어느 계정에 붙어 있는지는 Orca 만 안다. 행마다 박아 두면 일부만 갱신했을 때
  // 옛 표시가 남아 별표가 둘이 된다. 한 곳에 두고 화면이 그때그때 비교한다.
  const [activeId, setActiveId] = useState(() => accounts.find((a) => a.active)?.id ?? null)
  // poll 안에서 읽으므로 ref 로도 들고 있는다. 의존성에 넣으면 계정이 바뀔 때마다
  // 폴링 타이머가 통째로 다시 걸린다.
  const activeIdRef = useRef(activeId)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
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
  const lastSwitchAt = useRef(saved.lastSwitchAt)
  const switching = useRef(false)
  const [decision, setDecision] = useState(null)
  const [showModelWindows, setShowModelWindows] = useState(saved.showModelWindows)
  const [message, setMessage] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [nextPollAt, setNextPollAt] = useState(Date.now() + intervalMs)

  // 왼쪽 폭은 내용이 정한다. 비율로 잡으면 좁은 터미널에서 이름이 잘리고 넓은
  // 터미널에서는 빈 자리가 남는다. 오른쪽 그래프가 나머지를 다 쓴다.
  const barWidth = 26
  const panelWidth = useMemo(() => {
    const labelOf = (row) => (row.label ? row.label.length + 4 : 0)
    // 머리글: 들여쓰기와 번호, 별표 자리, 이름, 요금제, 배지
    const header = 5 + 2 + Math.max(0, ...rows.map((row) => row.email.length))
      + Math.max(0, ...rows.map(labelOf)) + 11
    // 막대 줄: 들여쓰기, 창 이름, 막대, 퍼센트, 남은 시간
    const bar = 5 + 7 + barWidth + 5 + 9
    // 좌우 패딩 둘과 테두리 둘
    return Math.min(columns - 24, Math.max(header, bar) + 4)
  }, [rows, columns])

  const running = useRef(false)
  const timer = useRef(null)

  const notify = useCallback((text) => {
    setMessage(text)
    // 상시로 띄워 두는 화면이라 눈이 늘 여기 있지 않다. 짧으면 놓친다.
    setTimeout(() => setMessage(null), 8000)
  }, [])

  /**
   * Orca 가 지금 붙어 있는 계정을 따라간다.
   *
   * ~/.claude.json 은 Claude Code 가 로그인할 때 쓰는 파일이라 Orca 에서 계정을
   * 바꿔도 그대로다. 앱에 직접 물어야 손으로 바꾼 것이 화면에 뜬다.
   */
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const id = await activeAccountId()
        if (alive && id) setActiveId(id)
      } catch { /* Orca 가 꺼져 있으면 마지막으로 안 값을 그대로 둔다 */ }
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
      selectedId: selected >= 0 ? (rows[selected]?.id ?? null) : null,
    })
  }, [graphMode, rangeIndex, showModelWindows, showGraph, autoSwitch, selected, rows])

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
    const verdict = decideSwitch(fresh, advise(fresh, loadHistory()), {
      activeId: activeIdRef.current,
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
      if (allowSwitch.current) await maybeSwitch(fresh)
      else {
        setDecision(decideSwitch(fresh, advise(fresh, loadHistory()), {
          activeId: activeIdRef.current,
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
    poll()
    timer.current = setInterval(() => poll(), intervalMs)
    return () => clearInterval(timer.current)
  }, [poll, intervalMs])

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
    notify(`${row.email} 토큰 재생성`)
    poll({ force: true, forceRefresh: true, only: [row.id] })
  }, [rows, selected, allowRefresh, notify, poll])

  /** 지금 고른 계정으로 Orca 를 옮긴다. 자동 전환과 같은 경로를 쓴다. */
  const switchToSelected = useCallback(async () => {
    if (selected < 0) return notify('계정을 고른 뒤 눌러 주세요')
    const row = rows[selected]
    if (!row) return
    if (row.id === activeId) return notify('이미 이 계정에 붙어 있습니다')
    if (switching.current) return

    switching.current = true
    try {
      await selectClaudeAccount(row.id)
      // 다음 확인까지 기다리면 눌러 놓고 표시가 안 바뀐다.
      setActiveId(row.id)
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
  }, [rows, selected, activeId, notify, poll])

  const runAction = useCallback((key) => {
    if (key === 'r') doRefresh()
    else if (key === 't') doToken()
    else if (key === 'g') setShowGraph((value) => !value)
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
      setShowModelWindows((value) => {
        notify(value ? 'Fable 숨김' : 'Fable 표시')
        return !value
      })
    }
    else if (key === 'd') {
      setGraphMode((value) => {
        const next = value === 'level' ? 'rate' : 'level'
        notify(next === 'rate' ? '그래프: 시간당 소비' : '그래프: 사용량')
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
      } else if ('rtdfgqwa'.includes(char)) runAction(char)
    }
  })

  // 화면을 위에서부터 쌓아 클릭 좌표를 행으로 되짚는다. 액션 바는 항상 맨 아래다.
  const layout = useMemo(() => ({
    panelWidth,
    // 그래프는 본문 높이에서 상자 테두리 두 줄만 뺀 만큼을 쓴다.
    graphHeight: Math.max(6, screenRows - HEADER_ROWS - 1 - 2),
  }), [panelWidth, screenRows])

  // 각 항목이 자기 위치를 알려 온다. 행을 손으로 세지 않으므로 창을 접거나
  // 계정이 늘어도 따로 맞출 것이 없다.
  const hits = useRef(new Map())
  const columnTop = useRef(0)
  const onHit = useCallback((id, top, height) => {
    hits.current.set(id, { top, height })
  }, [])
  const onColumnTop = useCallback((top) => {
    columnTop.current = top
  }, [])

  const onClick = useCallback((row, column) => {
    if (column > layout.panelWidth) return
    // 마우스는 1 부터 세고 배치 좌표는 0 부터 센다.
    const y = row - 1 - columnTop.current
    for (const [id, box] of hits.current) {
      if (y >= box.top && y < box.top + box.height) {
        setSelected(() => id)
        return
      }
    }
  }, [layout.panelWidth])

  useMouseReporting()

  // 추천은 계정 목록의 배지와 아래 요약이 함께 쓴다. 한 번만 계산한다.
  const tip = useMemo(() => advise(rows, history, now), [rows, history, now])
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
        selected={selected}
      />
      <HitRoot onMeasure={onColumnTop} flexGrow={1} flexDirection="row">
        <Box
          width={layout.panelWidth}
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <Hit id={-1} onMeasure={onHit}>
            <TotalBars
            rows={rows}
            width={layout.panelWidth - 4}
            now={now}
            showModelWindows={showModelWindows}
              selected={selected === -1}
            />
          </Hit>
          {rows.map((row, index) => (
            <Hit key={row.id} id={index} onMeasure={onHit}>
              <AccountBlock
                row={row}
                active={row.id === activeId}
                selected={index === selected}
                now={now}
                barWidth={barWidth}
                showModelWindows={showModelWindows}
                staleAfterMs={intervalMs * 4}
                badge={tip?.badges?.[row.id]}
              />
            </Hit>
          ))}
          <Box flexGrow={1} flexDirection="column" justifyContent="flex-end">
            <Advice tip={tip} autoSwitch={autoSwitch} decision={decision} />
            <Text> </Text>
            <BadgeLegend />
          </Box>
        </Box>

        <Box
          flexGrow={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
        >
          {showGraph
            ? (current
                ? (
                  <Graph
                    row={current}
                    history={history[current.id] ?? []}
                    columns={columns - layout.panelWidth - 4}
                    height={layout.graphHeight}
                    mode={graphMode}
                    showModelWindows={showModelWindows}
                    rangeMs={RANGES[rangeIndex].ms}
                    rangeLabel={RANGES[rangeIndex].label}
                  />
                  )
                : (
                  <OverviewGraph
                    accounts={rows}
                    historyById={history}
                    columns={columns - layout.panelWidth - 4}
                    height={layout.graphHeight}
                    mode={graphMode}
                    showModelWindows={showModelWindows}
                    rangeMs={RANGES[rangeIndex].ms}
                    rangeLabel={RANGES[rangeIndex].label}
                  />
                  ))
            : null}
        </Box>
      </HitRoot>
      <ActionBar />
    </Box>
  )
}
