import net from 'node:net'
import { frame, lineReader } from './protocol.js'

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
export function createServer(engine, { hello, onShutdown }) {
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
    checkUpdate: () => engine.checkUpdate(),
    update: () => engine.update(),
    shutdown: () => {
      // 답이 나간 뒤에 내린다. 바로 내리면 부른 쪽은 답 대신 끊김을 받는다.
      setTimeout(onShutdown, 100)
      return { ok: true }
    },
  }

  const send = (client, payload) => {
    if (!client.socket.destroyed) client.socket.write(frame(payload))
  }

  const broadcast = (event, data) => {
    for (const client of clients) if (client.subscribed) send(client, { event, data })
  }
  engine.on('state', (data) => broadcast('state', data))
  engine.on('log', (data) => broadcast('log', data))

  const server = net.createServer((socket) => {
    const client = { socket, subscribed: false }
    clients.add(client)
    socket.setEncoding('utf8')
    socket.on('data', lineReader(async (message) => {
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
    }, () => send(client, { id: null, error: { message: 'JSON 이 아닌 줄을 받았습니다' } })))
    socket.on('close', () => clients.delete(client))
    // 화면이 갑자기 꺼지면 EPIPE 가 온다. 그 연결만 버리면 된다.
    socket.on('error', () => clients.delete(client))
  })
  return server
}
