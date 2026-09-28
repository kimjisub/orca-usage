import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { connect } from '../src/client/connection.js'
import { acquirePid, releasePid } from '../src/daemon/instance.js'
import { lineReader } from '../src/daemon/protocol.js'
import { createServer } from '../src/daemon/server.js'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-usage-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

/** 엔진 대신 서 있는 것. 불린 메서드와 인자를 적어 둔다. */
function fakeEngine() {
  const engine = new EventEmitter()
  engine.calls = []
  engine.snapshot = () => ({ accounts: [{ id: 'a' }] })
  engine.history = (since) => ({ a: [{ at: since + 1 }] })
  engine.log = () => [{ kind: 'poll', text: 'x' }]
  engine.refresh = async () => ({ ok: true })
  engine.setTuning = (key, value) => {
    if (value > 100) throw new Error('범위 밖입니다')
    engine.calls.push(['setTuning', key, value])
    return { [key]: value }
  }
  engine.setHidden = (id, hidden) => engine.calls.push(['setHidden', id, hidden])
  return engine
}

async function serve(engine, onShutdown = () => {}, options = {}) {
  const socketPath = path.join(dir, 'd.sock')
  const server = createServer(engine, { hello: () => ({ protocol: 1, pid: 42 }), onShutdown, ...options })
  await new Promise((resolve) => server.listen(socketPath, resolve))
  return { server, socketPath }
}

describe('소켓 서버', () => {
  test('요청에 답하고 인자를 엔진에 넘긴다', async () => {
    const engine = fakeEngine()
    const { server, socketPath } = await serve(engine)
    const connection = await connect(socketPath)
    expect(await connection.request('hello')).toEqual({ protocol: 1, pid: 42 })
    expect(await connection.request('history', { since: 10 })).toEqual({ a: [{ at: 11 }] })
    await connection.request('setHidden', { accountId: 'b', hidden: 1 })
    expect(engine.calls).toEqual([['setHidden', 'b', true]])
    connection.close()
    server.close()
  })

  test('엔진이 거절하면 이유가 그대로 돌아온다', async () => {
    const { server, socketPath } = await serve(fakeEngine())
    const connection = await connect(socketPath)
    await expect(connection.request('setTuning', { key: 'switchAt', value: 200 })).rejects.toThrow('범위 밖입니다')
    await expect(connection.request('nope')).rejects.toThrow('모르는 메서드')
    connection.close()
    server.close()
  })

  test('구독한 연결에만 state 와 log 를 흘린다', async () => {
    const engine = fakeEngine()
    const { server, socketPath } = await serve(engine)
    const subscriber = await connect(socketPath)
    const other = await connect(socketPath)
    const got = []
    const leaked = []
    subscriber.on('state', (data) => got.push(['state', data]))
    subscriber.on('log', (data) => got.push(['log', data]))
    other.on('state', (data) => leaked.push(data))
    await subscriber.request('subscribe')
    await other.request('hello')
    engine.emit('state', { n: 1 })
    engine.emit('log', { text: 'y' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(got).toEqual([['state', { n: 1 }], ['log', { text: 'y' }]])
    expect(leaked).toEqual([])
    subscriber.close()
    other.close()
    server.close()
  })

  test('JSON 이 아닌 줄을 받아도 연결을 유지한다', async () => {
    const { server, socketPath } = await serve(fakeEngine())
    const raw = net.createConnection(socketPath)
    const lines = []
    raw.setEncoding('utf8')
    raw.on('data', (chunk) => lines.push(...chunk.trim().split('\n')))
    await new Promise((resolve) => raw.once('connect', resolve))
    raw.write('이건 JSON 아님\n')
    raw.write(`${JSON.stringify({ id: 1, method: 'hello' })}\n`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const parsed = lines.map((line) => JSON.parse(line))
    expect(parsed[0].error.message).toContain('JSON')
    expect(parsed[1]).toEqual({ id: 1, result: { protocol: 1, pid: 42 } })
    raw.end()
    server.close()
  })

  test('shutdown 은 답을 보낸 뒤 내린다', async () => {
    let down = false
    const { server, socketPath } = await serve(fakeEngine(), () => { down = true })
    const connection = await connect(socketPath)
    expect(await connection.request('shutdown')).toEqual({ ok: true })
    expect(down).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(down).toBe(true)
    connection.close()
    server.close()
  })
})

describe('밀린 연결과 긴 줄', () => {
  test('소켓을 안 읽는 구독자는 쌓인 것이 한도를 넘으면 끊는다', async () => {
    const engine = fakeEngine()
    const { server, socketPath } = await serve(engine, () => {}, { maxPending: 64 * 1024 })
    const raw = net.createConnection(socketPath)
    await new Promise((resolve) => raw.once('connect', resolve))
    raw.write(`${JSON.stringify({ id: 1, method: 'subscribe' })}\n`)
    await new Promise((resolve) => setTimeout(resolve, 30))
    // Ctrl+Z 로 멈춘 화면처럼 더는 읽지 않는다.
    raw.pause()
    const closed = new Promise((resolve) => raw.once('close', resolve))
    const big = { blob: 'x'.repeat(256 * 1024) }
    for (let i = 0; i < 64; i += 1) {
      engine.emit('state', big)
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    raw.resume()
    await closed
    expect(engine.listenerCount('state')).toBe(1)
    server.close()
  })

  test('개행 없이 한도를 넘는 줄은 버리고 다음 줄부터 읽는다', () => {
    const got = []
    const bad = []
    const read = lineReader((message) => got.push(message), (line) => bad.push(line), { maxLine: 16 })
    read('{"a":1}\n')
    read('y'.repeat(20))
    read('y'.repeat(20))
    read('끝\n{"b":2}\n')
    expect(got).toEqual([{ a: 1 }, { b: 2 }])
    // 한도를 넘은 순간 그때까지 받은 것만 넘기고 비운다. 나머지는 쌓지 않는다.
    expect(bad).toEqual(['y'.repeat(20)])
  })
})

describe('단일 인스턴스', () => {
  test('처음 잡으면 된다', () => {
    const file = path.join(dir, 'd.pid')
    expect(acquirePid(file)).toEqual({ ok: true })
    expect(fs.readFileSync(file, 'utf8')).toBe(String(process.pid))
    releasePid(file)
    expect(fs.existsSync(file)).toBe(false)
  })

  test('살아 있는 다른 프로세스가 쥐고 있으면 물러난다', () => {
    const file = path.join(dir, 'd.pid')
    fs.writeFileSync(file, String(process.ppid))
    expect(acquirePid(file)).toEqual({ ok: false, pid: process.ppid })
    releasePid(file)
    expect(fs.readFileSync(file, 'utf8')).toBe(String(process.ppid))
  })

  test('죽은 프로세스가 남긴 파일은 덮어쓴다', () => {
    const file = path.join(dir, 'd.pid')
    fs.writeFileSync(file, '999999')
    expect(acquirePid(file)).toEqual({ ok: true })
  })
})
