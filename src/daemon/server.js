import net from 'node:net'
import { frame, lineReader } from './protocol.js'

// 한 연결에 보내지 못하고 쌓인 바이트의 상한. 화면이 Ctrl+Z 로 멈췄거나 터미널이
// 출력을 안 읽어 멈추면 소켓을 안 읽고, 그동안 state 가 여기 쌓인다. 넘으면
// 끊는다. 화면은 끊기면 다시 붙어 그때의 상태를 새로 받는다(ui/useBackend.js).
export const MAX_PENDING_BYTES = 8 * 1024 * 1024

/**
 * 엔진을 소켓에 연다. 요청은 엔진의 메서드로 옮기고, 엔진이 낸 state 와 log 를
 * 구독한 연결에 흘려보낸다.
 *
 * 판정은 전부 엔진이 한다. 여기서는 모양만 본다(메서드가 있는지, 인자가
 * 객체인지). 화면이 무엇을 보내든 엔진의 검사를 거친다.
 *
 * @param {import('../engine/engine.js').Engine} engine
 * @param {{hello: () => object, onShutdown: () => void}} options
 */
export function createServer(engine, { hello, onShutdown, maxPending = MAX_PENDING_BYTES }) {
  const clients = new Set()

  const handlers = {
    hello: () => hello(),
    snapshot: () => engine.snapshot(),
    subscribe: (_params, client) => {
      client.subscribed = true
      return engine.snapshot()
    },
    history: ({ since = 0 }) => engine.history(Number(since) || 0),
    log: () => engine.log(),
    refresh: () => engine.refresh(),
    refreshToken: ({ accountId }) => engine.refreshToken(accountId),
    switch: ({ accountId }) => engine.switchTo(accountId),
    setPolicy: (params) => engine.setPolicy(params),
    setTuning: ({ key, value }) => engine.setTuning(key, value),
    resetTuning: ({ key }) => engine.resetTuning(key),
    setHidden: ({ accountId, hidden }) => engine.setHidden(accountId, Boolean(hidden)),
    useResetCredit: ({ accountId }) => engine.useResetCredit(accountId),
    checkUpdate: () => engine.checkUpdate(),
    update: () => engine.update(),
    shutdown: () => {
      // 답이 나간 뒤에 내린다. 바로 내리면 부른 쪽은 답 대신 끊김을 받는다.
      setTimeout(onShutdown, 100)
      return { ok: true }
    },
  }

  const send = (client, payload) => {
    const { socket } = client
    if (socket.destroyed) return
    if (socket.writableLength > maxPending) {
      clients.delete(client)
      socket.destroy()
      return
    }
    socket.write(frame(payload))
  }

  const broadcast = (event, data) => {
    for (const client of clients) if (client.subscribed) send(client, { event, data })
  }
  engine.on('state', (data) => broadcast('state', data))
  engine.on('log', (data) => broadcast('log', data))

  // 한 번 묻고 입력을 닫는 클라이언트(nc -U, Claude Code mod)가 있다. 기본값이면
  // 그 순간 이쪽도 닫혀, 몇 초 걸리는 요청(재조회, 전환, 리셋 크레딧)은 실행되고
  // 답만 사라진다. 그래서 반쯤 열린 채로 두고, 받은 요청에 다 답한 뒤에 닫는다.
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    const client = { socket, subscribed: false, pending: 0, ended: false }
    clients.add(client)
    socket.setEncoding('utf8')
    const closeIfDone = () => {
      if (client.ended && client.pending === 0 && !client.subscribed && !socket.destroyed) socket.end()
    }
    socket.on('end', () => {
      client.ended = true
      // 구독한 쪽이 입력을 닫았으면 더 받을 사람이 없다.
      client.subscribed = false
      closeIfDone()
    })
    socket.on('data', lineReader(async (message) => {
      client.pending += 1
      try {
        await answer(message)
      } finally {
        client.pending -= 1
        closeIfDone()
      }
    }, () => send(client, { id: null, error: { message: 'JSON 이 아닌 줄을 받았습니다' } })))

    async function answer(message) {
      const id = message?.id ?? null
      const handler = typeof message?.method === 'string' ? handlers[message.method] : null
      if (!handler) {
        send(client, { id, error: { message: `모르는 메서드입니다: ${message?.method}` } })
        return
      }
      const params = message.params && typeof message.params === 'object' ? message.params : {}
      try {
        const result = await handler(params, client)
        send(client, { id, result: result ?? null })
      } catch (error) {
        send(client, { id, error: { message: error?.message ?? String(error) } })
      }
    }
    socket.on('close', () => clients.delete(client))
    // 화면이 갑자기 꺼지면 EPIPE 가 온다. 그 연결만 버리면 된다.
    socket.on('error', () => clients.delete(client))
  })
  return server
}
