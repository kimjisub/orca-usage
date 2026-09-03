import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { BACKUP_DIR, KEYCHAIN_SERVICE, LOCK_PATH, SECURITY, STATE_DIR } from './paths.js'

const run = promisify(execFile)

// security -i 는 stdin 을 4096 바이트 fgets 로 읽는다. 넘으면 조용히 잘린다.
const SECURITY_STDIN_LIMIT = 4096 - 64
// 잠금을 쥔 프로세스가 죽어 파일만 남았을 때 이 시간이 지나면 뺏는다.
const LOCK_STALE_MS = 120_000

export class CredentialError extends Error {
  /**
   * @param {string} message
   * @param {{fatal?: boolean}} options 다시 로그인해야 풀리는 실패면 fatal 이다.
   *   키체인이 잠깐 잠겼거나 응답이 늦은 것은 다음 조회에 나으므로 아니다.
   */
  constructor(message, { fatal = false } = {}) {
    super(message)
    this.fatal = fatal
  }
}

export async function readCredentials(accountId) {
  try {
    const { stdout } = await run(SECURITY, [
      'find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', accountId, '-w',
    ], { timeout: 15_000, maxBuffer: 1 << 20 })
    return stdout.trim()
  } catch (error) {
    if (error.code === 44 || error.code === 1) {
      throw new CredentialError('키체인 항목 없음', { fatal: true })
    }
    throw new CredentialError('키체인 접근 실패')
  }
}

export async function writeCredentials(accountId, payload) {
  const hex = Buffer.from(payload, 'utf8').toString('hex')
  const line = `add-generic-password -U -a ${accountId} -s '${KEYCHAIN_SERVICE}' -X ${hex}\n`
  try {
    if (Buffer.byteLength(line, 'utf8') <= SECURITY_STDIN_LIMIT) {
      // stdin 경로가 우선이다. 값이 argv 에 안 남는다.
      const child = run(SECURITY, ['-i'], { timeout: 15_000 })
      child.child.stdin.end(line)
      await child
    } else {
      // stdin 버퍼를 넘기면 조용히 잘리므로 argv 로 넘긴다. 16진이라 평문
      // 검색에는 안 걸리지만 ps 로는 잠깐 보인다.
      await run(SECURITY, [
        'add-generic-password', '-U', '-a', accountId,
        '-s', KEYCHAIN_SERVICE, '-X', hex,
      ], { timeout: 15_000 })
    }
  } catch {
    throw new CredentialError('키체인 쓰기 거부')
  }
}

export function backupCredentials(accountId, payload) {
  const dir = path.join(BACKUP_DIR, accountId)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${Date.now()}.json`)
  fs.writeFileSync(file, payload, { mode: 0o600, flag: 'wx' })
  // 계정마다 최근 10벌만 남긴다.
  const stale = fs.readdirSync(dir).sort().reverse().slice(10)
  for (const name of stale) fs.rmSync(path.join(dir, name), { force: true })
  return file
}

/** 토큰을 갱신하는 순간에만 잡는다. 잡지 못하면 이번 바퀴는 갱신을 건너뛴다. */
export async function withRefreshLock(fn) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  let held = false
  try {
    fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' })
    held = true
  } catch {
    const age = Date.now() - (fs.statSync(LOCK_PATH, { throwIfNoEntry: false })?.mtimeMs ?? 0)
    if (age > LOCK_STALE_MS) {
      fs.writeFileSync(LOCK_PATH, String(process.pid))
      held = true
    }
  }
  if (!held) return { acquired: false, value: undefined }
  try {
    return { acquired: true, value: await fn() }
  } finally {
    fs.rmSync(LOCK_PATH, { force: true })
  }
}
