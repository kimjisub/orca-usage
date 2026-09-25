import { EventEmitter } from 'node:events'
import net from 'node:net'
import { DAEMON_SOCKET } from '../paths.js'
import { frame, lineReader } from '../daemon/protocol.js'

const CONNECT_TIMEOUT_MS = 2_000
// 조회 한 바퀴는 Orca 재조회와 키체인을 거쳐 몇 초가 걸린다. 업데이트는 더 길다.
const REQUEST_TIMEOUT_MS = 60_000

/**
 * 백엔드와의 연결 하나. 요청을 보내고 답을 기다리며, 구독했으면 state 와 log
 * 알림을 이벤트로 낸다. 끊기면 'close' 를 낸다.
 */
export class Connection extends EventEmitter {
  constructor(socket) {
    super()
    this.socket = socket
    this.nextId = 1
    this.waiting = new Map()
    socket.setEncoding('utf8')
    socket.on('data', lineReader((message) => this.receive(message)))
    socket.on('close', () => {
      for (const { reject, timer } of this.waiting.values()) {
        clearTimeout(timer)
        reject(new Error('백엔드 연결이 끊겼습니다'))
      }
      this.waiting.clear()
      this.emit('close')
    })
    socket.on('error', () => {})
  }

  receive(message) {
    if (message.event) {
      this.emit(message.event, message.data)
      return
    }
    const pending = this.waiting.get(message.id)
    if (!pending) return
    this.waiting.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(message.error.message))
    else pending.resolve(message.result)
  }

  request(method, params = {}, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId
      this.nextId += 1
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error(`${method} 에 백엔드가 답하지 않습니다`))
      }, timeoutMs)
      this.waiting.set(id, { resolve, reject, timer })
      this.socket.write(frame({ id, method, params }))
    })
  }

  close() {
    this.socket.end()
  }
}

/**
 * 백엔드에 붙는다. 없으면 실패한다. 띄우는 것은 부르는 쪽이 정한다.
 *
 * @returns {Promise<Connection>}
 */
export function connect(socketPath = DAEMON_SOCKET, { timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('백엔드가 답하지 않습니다'))
    }, timeoutMs)
    socket.once('connect', () => {
      clearTimeout(timer)
      resolve(new Connection(socket))
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

/** 한 번 묻고 끊는다. CLI 명령이 쓴다. */
export async function call(method, params = {}, options = {}) {
  const connection = await connect(options.socketPath)
  try {
    return await connection.request(method, params, options)
  } finally {
    connection.close()
  }
}

/** 백엔드가 떠서 답하는가. */
export async function answers(socketPath = DAEMON_SOCKET) {
  try {
    const hello = await call('hello', {}, { socketPath, timeoutMs: 2_000 })
    return hello ?? true
  } catch {
    return null
  }
}
