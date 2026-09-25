import { useCallback, useEffect, useRef, useState } from 'react'
import { connect } from '../client/connection.js'
import { wakeIfRegistered } from '../client/ensure.js'

// 끊긴 뒤 다시 붙는 간격. launchd 는 크래시 뒤 10초 안에 다시 띄운다.
const RETRY_MS = 2_000
// 이만큼 연달아 못 붙으면 launchd 에 깨우라고 한다. 등록돼 있지 않으면 기다리기만 한다.
const RETRIES_BEFORE_WAKE = 3
// 백엔드는 오래된 표본을 솎는다. 화면이 받은 것에 덧붙이기만 하면 그 솎음이
// 반영되지 않아 긴 세션에서 화면 쪽만 불어난다. 이만큼마다 통째로 다시 받는다.
const FULL_HISTORY_MS = 30 * 60_000

/** 받은 히스토리에 새 표본을 덧붙인다. 같은 시각은 다시 넣지 않는다. */
function mergeHistory(previous, incoming) {
  const next = { ...previous }
  for (const [id, points] of Object.entries(incoming)) {
    const series = next[id] ? [...next[id]] : []
    const last = series.at(-1)?.at ?? 0
    for (const point of points) if (point.at > last) series.push(point)
    next[id] = series
  }
  return next
}

/**
 * 백엔드에 붙어 그 상태를 그대로 들고 있는다. 화면이 가진 상태의 정본은
 * 전부 여기서 온다. 화면은 이것을 그리고, 사람이 누른 것을 request 로 보낸다.
 *
 * 백엔드를 마련하는 것은 화면을 열기 전의 일이다(cli.jsx 의 requireBackend).
 * 여기서는 띄우지 않는다. 끊기면 2초마다 다시 붙고, 세 번 못 붙으면 launchd 에
 * 등록된 백엔드만 깨운다.
 *
 * @returns {{
 *   status: 'connecting'|'connected'|'lost',
 *   snapshot: object|null, history: object, log: object[], hello: object|null,
 *   request: (method: string, params?: object, options?: object) => Promise<any>,
 * }}
 */
export function useBackend() {
  const [status, setStatus] = useState('connecting')
  const [snapshot, setSnapshot] = useState(null)
  const [history, setHistory] = useState({})
  const [log, setLog] = useState([])
  const [hello, setHello] = useState(null)
  const connection = useRef(null)
  const historyAt = useRef(0)
  const alive = useRef(true)

  const loadHistory = useCallback(async (full) => {
    const link = connection.current
    if (!link) return
    const since = full ? 0 : historyAt.current
    const incoming = await link.request('history', { since })
    let latest = historyAt.current
    for (const points of Object.values(incoming)) latest = Math.max(latest, points.at(-1)?.at ?? 0)
    historyAt.current = latest
    setHistory((previous) => (full ? incoming : mergeHistory(previous, incoming)))
  }, [])

  useEffect(() => {
    alive.current = true
    let retryTimer = null
    let failures = 0

    const attach = async () => {
      let link
      try {
        link = await connect()
      } catch {
        failures += 1
        if (failures === RETRIES_BEFORE_WAKE) await wakeIfRegistered().catch(() => {})
        if (alive.current) retryTimer = setTimeout(attach, RETRY_MS)
        return
      }
      if (!alive.current) {
        link.close()
        return
      }
      failures = 0
      connection.current = link
      link.on('state', (next) => {
        setSnapshot(next)
        if (next.historyAt > historyAt.current) loadHistory(false).catch(() => {})
      })
      link.on('log', (entry) => {
        setLog((previous) => [entry, ...previous].slice(0, 2000))
      })
      link.on('close', () => {
        connection.current = null
        if (!alive.current) return
        setStatus('lost')
        retryTimer = setTimeout(attach, RETRY_MS)
      })
      try {
        setHello(await link.request('hello'))
        setSnapshot(await link.request('subscribe'))
        setLog(await link.request('log'))
        historyAt.current = 0
        await loadHistory(true)
        setStatus('connected')
      } catch {
        link.close()
      }
    }

    attach()

    const refreshAll = setInterval(() => loadHistory(true).catch(() => {}), FULL_HISTORY_MS)
    return () => {
      alive.current = false
      clearTimeout(retryTimer)
      clearInterval(refreshAll)
      connection.current?.close()
    }
  }, [loadHistory])

  const request = useCallback((method, params = {}, options = {}) => {
    const link = connection.current
    if (!link) return Promise.reject(new Error('백엔드에 붙어 있지 않습니다'))
    return link.request(method, params, options)
  }, [])

  return { status, snapshot, history, log, hello, request }
}
