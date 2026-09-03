import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { HOME } from './paths.js'

const METADATA_PATH = path.join(HOME, 'Library/Application Support/orca/orca-runtime.json')
const TIMEOUT_MS = 10_000

/**
 * Orca 런타임에 직접 RPC 를 건다.
 *
 * `orca` CLI 가 쓰는 바로 그 경로다. 앱이 자기 로직으로 처리하므로 키체인, 앱
 * 상태, 화면 표시가 모두 일관되게 따라온다. 접근성으로 창을 눌러 전환하는 방법도
 * 있지만 그쪽은 화면이 켜져 있고 포커스를 내줘야 해서 헤드리스에서는 못 쓴다.
 *
 * 봉투는 줄 단위 JSON 하나다: {id, authToken, method, params}\n
 */
function readMetadata() {
  const metadata = JSON.parse(fs.readFileSync(METADATA_PATH, 'utf8'))
  const unix = metadata.transports?.find((entry) => entry.kind === 'unix')
  if (!unix?.endpoint || !metadata.authToken) {
    throw new Error('Orca 런타임 정보가 불완전합니다. Orca 앱이 떠 있는지 확인하세요.')
  }
  return { endpoint: unix.endpoint, authToken: metadata.authToken }
}

export function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    let metadata
    try {
      metadata = readMetadata()
    } catch (error) {
      reject(error)
      return
    }

    const socket = net.createConnection(metadata.endpoint)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error(`${method} 응답이 없습니다`))
    }, TIMEOUT_MS)

    const done = (error, value) => {
      clearTimeout(timer)
      socket.end()
      if (error) reject(error)
      else resolve(value)
    }

    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk
      let cut
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 1)
        if (!line.trim()) continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        // 런타임은 keepalive 프레임도 흘려보낸다. 우리 요청의 답만 받는다.
        if (message.id !== 'orca-usage') continue
        if (message.error) done(new Error(message.error.message ?? String(message.error)))
        else done(null, message.result)
        return
      }
    })
    socket.on('error', (error) => done(error))
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({
        id: 'orca-usage', authToken: metadata.authToken, method, params,
      })}\n`)
    })
  })
}

/** 지금 Orca 가 붙어 있는 Claude 계정 id. */
export async function activeAccountId() {
  const result = await call('accounts.list', { refreshUsage: false })
  return result?.claude?.activeAccountId ?? null
}

/**
 * Orca 의 활성 Claude 계정을 바꾼다.
 *
 * 이미 떠 있는 터미널은 옛 계정으로 계속 돈다. 바뀐 계정은 그다음에 여는
 * 세션부터 적용된다.
 */
export async function selectClaudeAccount(accountId) {
  await call('accounts.selectClaude', { accountId })
}
