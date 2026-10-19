import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  BACKUP_DIR, CLAUDE_CODE_SERVICE, KEYCHAIN_SERVICE, LOCK_PATH, ORCA_PROFILES, SECURITY, STATE_DIR,
} from '../../paths.js'

// 키체인 명령과 파일 자리. 테스트가 바꿔 끼워 진짜 키체인과 Orca 폴더를 건드리지 않는다.
export const io = {
  run: promisify(execFile),
  profiles: ORCA_PROFILES,
  backups: BACKUP_DIR,
  stateDir: STATE_DIR,
  lock: LOCK_PATH,
}

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

// 키체인 명령줄에 그대로 들어가는 값이라 따옴표나 줄바꿈이 섞이면 안 된다.
const SAFE_NAME = /^[A-Za-z0-9 ._-]+$/

/** Claude Code 가 키체인 항목의 계정 칸에 쓰는 이름. Orca 와 같은 규칙이다. */
function keychainUser() {
  let name
  try {
    name = process.env.USER || process.env.USERNAME || os.userInfo().username
  } catch {
    return 'claude-code-user'
  }
  return /^[a-zA-Z0-9._-]+$/.test(name) ? name : 'claude-code-user'
}

/** CLAUDE_CONFIG_DIR 하나에 Claude Code 가 쓰는 항목 이름. 경로 SHA-256 의 앞 8자가 붙는다. */
export function profileService(configDir) {
  const hash = createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8)
  return `${CLAUDE_CODE_SERVICE}-${hash}`
}

/** 같은 폴더의 다른 표기. 링크를 거친 경로면 Claude Code 가 실제 경로로 해시했을 수 있다. */
function spellings(dir) {
  const out = [dir]
  try {
    const real = fs.realpathSync(dir)
    if (real !== dir) out.push(real)
  } catch { /* 폴더가 없으면 원래 표기만 본다 */ }
  return out
}

async function itemExists({ service, account }) {
  try {
    await io.run(SECURITY, ['find-generic-password', '-s', service, '-a', account], { timeout: 15_000 })
    return true
  } catch (error) {
    if (error.code === 44) return false
    // 잠긴 키체인을 "없음" 으로 읽으면 옛 항목으로 넘어가 낡은 토큰을 보게 된다.
    throw new CredentialError('키체인 접근 실패')
  }
}

/**
 * 이 계정의 토큰이 지금 들어 있는 키체인 항목.
 *
 * Orca 는 계정마다 claude-profiles/<id>/home 을 CLAUDE_CONFIG_DIR 로 주고 세션을
 * 띄운다. 그 세션의 Claude Code 는 폴더 해시가 붙은 자기 항목을 읽고 갱신하고,
 * Orca 의 사용량 조회도 그 항목을 먼저 읽는다. 실측 2026-10-19: 프로필이 생긴
 * 10/15 이후 옛 항목(KEYCHAIN_SERVICE)은 백엔드만 갱신했고, 재로그인한 새 토큰은
 * 프로필 항목에만 들어갔다. 그래서 프로필 항목이 있으면 그것이 정본이다.
 *
 * @returns {Promise<{kind: 'profile'|'managed', service: string, account: string}>}
 */
export async function locateCredentials(accountId) {
  const home = path.join(io.profiles, accountId, 'home')
  if (fs.existsSync(home)) {
    for (const dir of spellings(home)) {
      const where = { kind: 'profile', service: profileService(dir), account: keychainUser() }
      if (await itemExists(where)) return where
    }
  }
  return { kind: 'managed', service: KEYCHAIN_SERVICE, account: accountId }
}

export async function readCredentialsAt({ service, account }) {
  try {
    const { stdout } = await io.run(SECURITY, [
      'find-generic-password', '-s', service, '-a', account, '-w',
    ], { timeout: 15_000, maxBuffer: 1 << 20 })
    return stdout.trim()
  } catch (error) {
    if (error.code === 44 || error.code === 1) {
      throw new CredentialError('키체인 항목 없음', { fatal: true })
    }
    throw new CredentialError('키체인 접근 실패')
  }
}

export async function readCredentials(accountId) {
  return readCredentialsAt(await locateCredentials(accountId))
}

export async function writeCredentialsAt({ service, account }, payload) {
  if (!SAFE_NAME.test(service) || !SAFE_NAME.test(account)) throw new CredentialError('키체인 항목 이름 이상')
  const hex = Buffer.from(payload, 'utf8').toString('hex')
  const line = `add-generic-password -U -a '${account}' -s '${service}' -X ${hex}\n`
  try {
    if (Buffer.byteLength(line, 'utf8') <= SECURITY_STDIN_LIMIT) {
      // stdin 경로가 우선이다. 값이 argv 에 안 남는다.
      const child = io.run(SECURITY, ['-i'], { timeout: 15_000 })
      child.child.stdin.end(line)
      await child
    } else {
      // stdin 버퍼를 넘기면 조용히 잘리므로 argv 로 넘긴다. 16진이라 평문
      // 검색에는 안 걸리지만 ps 로는 잠깐 보인다.
      await io.run(SECURITY, [
        'add-generic-password', '-U', '-a', account,
        '-s', service, '-X', hex,
      ], { timeout: 15_000 })
    }
  } catch {
    throw new CredentialError('키체인 쓰기 거부')
  }
}

// 백업은 이 시간이 지나면 지운다. 되쓰기가 깨뜨린 것을 되돌리는 용도라 며칠이면
// 충분하고, 그 안의 refresh token 은 살아 있는 자격증명이라 오래 둘수록 위험하다.
const BACKUP_TTL_MS = 7 * 24 * 60 * 60_000

export function backupCredentials(accountId, payload, kind = 'managed') {
  const dir = path.join(io.backups, accountId)
  fs.mkdirSync(dir, { recursive: true })
  // 되쓰는 것은 claudeAiOauth 뿐이다. 키체인 항목에는 mcpOAuth 처럼 다른 서비스의
  // 토큰도 함께 들어 있는데, 우리가 손대지 않는 것을 평문으로 남길 이유가 없다.
  let slice = payload
  try {
    const { claudeAiOauth } = JSON.parse(payload)
    slice = JSON.stringify({ claudeAiOauth })
  } catch { /* 형식을 모르면 통째로 남긴다. 되돌릴 수 없는 백업이 더 나쁘다 */ }
  // 어느 항목에서 뜬 것인지 이름에 남긴다. 되돌릴 때 그 항목에 다시 써야 한다.
  const file = path.join(dir, `${kind}-${Date.now()}.json`)
  fs.writeFileSync(file, slice, { mode: 0o600, flag: 'wx' })
  const cutoff = Date.now() - BACKUP_TTL_MS
  for (const name of fs.readdirSync(dir)) {
    const stamp = Number(/(\d+)\.json$/.exec(name)?.[1])
    if (Number.isFinite(stamp) && stamp < cutoff) fs.rmSync(path.join(dir, name), { force: true })
  }
  return file
}

/** 토큰을 갱신하는 순간에만 잡는다. 잡지 못하면 이번 바퀴는 갱신을 건너뛴다. */
export async function withRefreshLock(fn) {
  fs.mkdirSync(io.stateDir, { recursive: true })
  let held = false
  try {
    fs.writeFileSync(io.lock, String(process.pid), { flag: 'wx' })
    held = true
  } catch {
    const age = Date.now() - (fs.statSync(io.lock, { throwIfNoEntry: false })?.mtimeMs ?? 0)
    if (age > LOCK_STALE_MS) {
      fs.writeFileSync(io.lock, String(process.pid))
      held = true
    }
  }
  if (!held) return { acquired: false, value: undefined }
  try {
    return { acquired: true, value: await fn() }
  } finally {
    fs.rmSync(io.lock, { force: true })
  }
}
